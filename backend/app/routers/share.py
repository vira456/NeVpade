"""Повідомлення замовнику у Viber: документи водія й машини + початок розмови про вантаж.

Надіслати у Viber від імені менеджера сервер не може (бот Viber не пише першим тим, хто на нього не
підписаний, а Viber Business Messages — платні й потребують ФОП/юрособи). Тому:

POST /trips/{id}/client-message  — готовий текст першого повідомлення, номер замовника і посилання
                                   viber://chat?number=…&draft=… : фронт відкриває Viber одразу в чаті з
                                   замовником, текст уже набрано — менеджеру лишається натиснути «Надіслати»
GET  /share/{token}              — публічна сторінка «документи на рейс» (коротке посилання з повідомлення,
                                   діє 7 днів; випадковий код у колекції shares)
GET  /share/{token}/files/{doc}  — файл документа з цієї сторінки
"""
import re
import secrets
from datetime import date, timedelta
from html import escape
from urllib.parse import quote

from fastapi import APIRouter, Depends, Request
from fastapi.responses import HTMLResponse, Response
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import current_user, db
from ..errors import ApiError, not_found
from ..schemas.entities import ClientMessageOut, SharedDocumentOut
from ..services.crud import find_ref, get_company_doc
from ..services.documents import file_response
from ..utils import KYIV, is_oid, iso, normalize_phone, now, oid, today_kyiv

router = APIRouter(tags=["Viber"])

SHARE_TTL = timedelta(days=7)  # скільки діє посилання для замовника
SHARE_RENEW_BEFORE = timedelta(days=2)  # якщо лишилось менше — видаємо нове

# Які документи бачить замовник. Лише ті, що потрібні для завантаження й пропуску на склад;
# ІПН, медична довідка, тахограф та «інше» лишаються всередині компанії.
SHARED_TYPES = {
    "drivers": {"passport": "Паспорт водія", "license": "Посвідчення водія"},
    "vehicles": {"registration": "Техпаспорт", "insurance": "Страховий поліс", "inspection": "Техогляд",
                 "license": "Ліцензія на перевезення", "lease": "Договір оренди авто"},
}
_OWNER = {"drivers": "driver", "vehicles": "vehicle"}


# ---------- Допоміжне ----------
def viber_number(raw: str | None) -> str | None:
    """Номер замовника для Viber: український → +380XXXXXXXXX, іноземний — лише цифри з «+»."""
    if not raw or not raw.strip():
        return None
    try:
        return normalize_phone(raw)
    except ValueError:
        digits = re.sub(r"\D", "", raw)
        return "+" + digits if 10 <= len(digits) <= 15 else None


def _date(value: str | None) -> str:
    """'2026-11-24' → '24.11.2026'."""
    try:
        return date.fromisoformat(value).strftime("%d.%m.%Y") if value else ""
    except ValueError:
        return value or ""


def _weight(value) -> str:
    return f"{float(value or 0):g} т"


async def _shared_documents(database: AsyncDatabase, company_id, driver: dict | None, vehicle: dict | None):
    """(дійсні документи для замовника, прострочені) — по одному найсвіжішому на кожен тип."""
    today = today_kyiv().isoformat()
    valid, expired = [], []
    for owner, item in (("drivers", driver), ("vehicles", vehicle)):
        if item is None:
            continue
        seen = set()
        cursor = database.documents.find(
            {"companyId": company_id, "ownerType": owner, "ownerId": str(item["_id"]),
             "type": {"$in": list(SHARED_TYPES[owner])}},
            {"fileId": 0},
        ).sort([("createdAt", -1), ("_id", -1)])
        async for doc in cursor:
            if doc["type"] in seen:
                continue
            seen.add(doc["type"])
            doc["owner"] = owner
            (expired if doc.get("validUntil") and doc["validUntil"] < today else valid).append(doc)
    return valid, expired


def _label(doc: dict) -> str:
    return SHARED_TYPES[doc["owner"]][doc["type"]]


def _message(trip: dict, *, company: dict | None, manager: dict | None, client: dict | None,
             driver: dict | None, vehicle: dict | None, share_url: str, expires: str) -> str:
    """Перше повідомлення замовнику: хто пише, який вантаж, хто їде, де документи, і питання, з якого почати розмову."""
    contact = (client or {}).get("contactName") or ""
    greeting = f"Добрий день, {contact}!" if contact else "Добрий день!"
    who = (manager or {}).get("name") or "менеджер"
    company_name = (company or {}).get("name") or "NeVpade"
    src, dst = trip.get("from") or {}, trip.get("to") or {}
    cargo = trip.get("cargo") or {}
    load_place = ", ".join(x for x in (src.get("city"), src.get("address")) if x)

    lines = [
        greeting,
        f"Це {who}, компанія «{company_name}». Пишу щодо перевезення вашого вантажу (рейс №{trip.get('number', '')}):",
        f"🚚 {src.get('city', '')} → {dst.get('city', '')}",
        f"📅 Завантаження: {_date(trip.get('loadDate'))}" + (f", {load_place}" if load_place else ""),
        f"📦 {cargo.get('type') or 'Вантаж'}, {_weight(cargo.get('weightT'))}",
        "",
        f"👤 Водій: {driver['name']}, {driver['phone']}" if driver else "👤 Водій: уточнюється",
        f"🚛 Авто: {vehicle['plate']} ({vehicle.get('model', '')})" if vehicle else "🚛 Авто: уточнюється",
        "",
        f"📎 Документи водія й машини: {share_url}",
        f"(посилання діє до {expires})",
        "",
        "Підтвердіть, будь ласка, що все підходить, і підкажіть точний час завантаження та контакт на місці.",
    ]
    return "\n".join(lines)


# ---------- Для менеджера ----------
@router.post("/trips/{trip_id}/client-message", response_model=ClientMessageOut)
async def client_message(trip_id: str, request: Request, user: dict = Depends(current_user),
                         database: AsyncDatabase = Depends(db)):
    """Готове повідомлення замовнику рейсу у Viber з посиланням на документи водія й машини."""
    trip = await get_company_doc(database, user, "trips", trip_id, "Рейс")
    driver = await find_ref(database, user, "drivers", trip.get("driverId"))
    vehicle = await find_ref(database, user, "vehicles", trip.get("vehicleId"))
    if driver is None and vehicle is None:
        raise ApiError(400, "Спершу призначте на рейс водія й машину", "driver_vehicle_required")
    client = await find_ref(database, user, "clients", trip.get("clientId"))
    company = await database.companies.find_one({"_id": user["companyId"]}, {"name": 1})
    manager = await find_ref(database, user, "users", trip.get("managerId"), {"name": 1}) or user

    share = await _share_for(database, trip, user)
    share_url = str(request.url_for("client_share_page", token=share["_id"]))
    expires_at = share["expiresAt"]
    expires = expires_at.astimezone(KYIV).strftime("%d.%m.%Y")
    text = _message(trip, company=company, manager=manager, client=client, driver=driver, vehicle=vehicle,
                    share_url=share_url, expires=expires)

    phone = viber_number((client or {}).get("phone") or (trip.get("client") or {}).get("phone"))
    valid, expired = await _shared_documents(database, user["companyId"], driver, vehicle)

    warnings = []
    if phone is None:
        warnings.append("У замовника не вказано телефон — Viber запропонує обрати контакт вручну")
    if driver is None:
        warnings.append("На рейс не призначено водія")
    if vehicle is None:
        warnings.append("На рейс не призначено машину")
    for owner, item, what in (("drivers", driver, "водія"), ("vehicles", vehicle, "машини")):
        if item is not None and not any(d["owner"] == owner for d in valid):
            warnings.append(f"У {what} немає дійсних документів — замовник побачить порожній список")
    warnings += [f"{_label(d)}: термін дії минув {_date(d['validUntil'])} — замовник його не побачить" for d in expired]

    return ClientMessageOut(
        phone=phone,
        text=text,
        share_url=share_url,
        expires_at=iso(expires_at),
        viber_url=f"viber://chat?number={quote(phone)}&draft={quote(text)}" if phone else None,
        forward_url=f"viber://forward?text={quote(text)}",
        documents=[SharedDocumentOut(owner=_OWNER[d["owner"]], type=d["type"], label=_label(d), name=d["name"],
                                     valid_until=d.get("validUntil")) for d in valid],
        warnings=warnings,
    )


# ---------- Для замовника (без входу, за посиланням) ----------
async def _share_for(database: AsyncDatabase, trip: dict, user: dict) -> dict:
    """Коротке посилання на рейс (/api/share/Xk3dE9aZ1qL0). Повторне натискання дає те саме посилання,
    поки йому лишається більше 2 днів; інакше — нове на 7 днів."""
    moment = now()
    share = await database.shares.find_one({"tripId": trip["_id"], "expiresAt": {"$gt": moment + SHARE_RENEW_BEFORE}})
    if share is not None:
        return share
    share = {"_id": secrets.token_urlsafe(9), "tripId": trip["_id"], "companyId": trip["companyId"],
             "createdBy": user["_id"], "createdAt": moment, "expiresAt": moment + SHARE_TTL}
    await database.shares.insert_one(share)
    return share


async def _shared_trip(database: AsyncDatabase, token: str):
    share = await database.shares.find_one({"_id": token}) if 8 <= len(token) <= 32 else None
    if share is None or share["expiresAt"] <= now():  # MongoDB прибирає прострочені із запізненням до хвилини
        return None
    trip = await database.trips.find_one({"_id": share["tripId"], "companyId": share["companyId"]})
    if trip is None:
        return None
    scope = {"companyId": trip["companyId"]}  # водій і машина — лише з тієї ж компанії
    driver = await find_ref(database, scope, "drivers", trip.get("driverId"))
    vehicle = await find_ref(database, scope, "vehicles", trip.get("vehicleId"))
    return trip, driver, vehicle


_PAGE_CSS = """
*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;
background:#f3f4f6;color:#111827;line-height:1.45}main{max-width:720px;margin:0 auto;padding:20px 16px 40px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:0 0 10px}.muted{color:#6b7280;font-size:14px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:16px;margin-top:14px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row>div{flex:1 1 200px}.k{color:#6b7280;font-size:13px}
.docs{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.doc{border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;background:#fafafa;text-decoration:none;color:inherit}
.doc img{width:100%;height:150px;object-fit:cover;display:block;background:#e5e7eb}
.doc .pdf{height:150px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#b91c1c;
background:#fee2e2;font-size:20px}.doc p{margin:0;padding:8px 10px;font-size:14px}a.tel{color:#2563eb}
@media (prefers-color-scheme:dark){body{background:#111827;color:#f9fafb}.card,.doc{background:#1f2937;
border-color:#374151}.muted,.k{color:#9ca3af}}
"""


def _page(title: str, body: str, status_code: int = 200, description: str = "") -> HTMLResponse:
    html = f"""<!doctype html><html lang="uk"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>{escape(title)}</title><meta property="og:title" content="{escape(title)}">
<meta property="og:description" content="{escape(description)}"><style>{_PAGE_CSS}</style></head>
<body><main>{body}</main></body></html>"""
    return HTMLResponse(html, status_code=status_code, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


def _person(title: str, lines: list[str]) -> str:
    return f'<div><div class="k">{escape(title)}</div>{"".join(f"<div>{x}</div>" for x in lines)}</div>'


def _tel(phone: str | None) -> str:
    return f'<a class="tel" href="tel:{escape(phone)}">{escape(phone)}</a>' if phone else ""


@router.get("/share/{token}", name="client_share_page", response_class=HTMLResponse, include_in_schema=False)
async def client_share_page(token: str, request: Request, database: AsyncDatabase = Depends(db)):
    found = await _shared_trip(database, token)
    if found is None:
        return _page("Посилання застаріло", '<div class="card"><h1>Посилання застаріло</h1><p class="muted">'
                     "Строк дії посилання минув або рейс видалено. Попросіть менеджера надіслати нове.</p></div>", 410)
    trip, driver, vehicle = found
    company = await database.companies.find_one({"_id": trip["companyId"]}, {"name": 1})
    manager = await database.users.find_one({"_id": oid(trip["managerId"])}, {"name": 1, "phone": 1}) \
        if is_oid(trip.get("managerId")) else None
    valid, _ = await _shared_documents(database, trip["companyId"], driver, vehicle)

    src, dst, cargo = trip.get("from") or {}, trip.get("to") or {}, trip.get("cargo") or {}
    route = f"{src.get('city', '')} → {dst.get('city', '')}"
    people = []
    if driver:
        people.append(_person("Водій", [escape(driver["name"]), _tel(driver.get("phone"))]))
    if vehicle:
        extra = ", ".join(x for x in (vehicle.get("type"), f"{vehicle.get('capacityT'):g} т" if vehicle.get("capacityT") else "") if x)
        people.append(_person("Автомобіль", [escape(f"{vehicle['plate']} · {vehicle.get('model', '')}"), escape(extra)]))
    if manager:
        people.append(_person("Менеджер", [escape(manager.get("name", "")), _tel(manager.get("phone"))]))

    def tile(doc: dict) -> str:
        url = escape(str(request.url_for("client_share_file", token=token, doc_id=str(doc["_id"]))))
        preview = (f'<img src="{url}" alt="" loading="lazy">' if doc["mime"].startswith("image/")
                   else '<div class="pdf">PDF</div>')
        valid_until = f'<br><span class="muted">дійсний до {_date(doc["validUntil"])}</span>' if doc.get("validUntil") else ""
        return f'<a class="doc" href="{url}" target="_blank" rel="noopener">{preview}<p><b>{escape(_label(doc))}</b>{valid_until}</p></a>'

    docs = "".join(tile(d) for d in valid) or '<p class="muted">Документи ще не додано — уточніть у менеджера.</p>'
    body = f"""
<p class="muted">{escape((company or {}).get("name") or "NeVpade")} · рейс №{escape(trip.get("number", ""))}</p>
<h1>{escape(route)}</h1>
<p class="muted">Завантаження {escape(_date(trip.get("loadDate")))} · {escape(cargo.get("type") or "вантаж")}, {escape(_weight(cargo.get("weightT")))}</p>
<div class="card"><div class="row">{"".join(people)}</div></div>
<div class="card"><h2>Документи водія й машини</h2><div class="docs">{docs}</div></div>
<p class="muted">Натисніть на документ, щоб відкрити його повністю.</p>"""
    return _page(f"Документи на рейс {route}", body, description=f"Водій і машина на рейс №{trip.get('number', '')}")


@router.get("/share/{token}/files/{doc_id}", name="client_share_file", include_in_schema=False)
async def client_share_file(token: str, doc_id: str, database: AsyncDatabase = Depends(db)) -> Response:
    found = await _shared_trip(database, token)
    if found is None or not is_oid(doc_id):
        raise ApiError(403, "Посилання застаріло. Попросіть менеджера надіслати нове", "share_link_expired")
    trip, driver, vehicle = found
    valid, _ = await _shared_documents(database, trip["companyId"], driver, vehicle)
    if not any(str(d["_id"]) == doc_id for d in valid):  # лише документи з цієї сторінки
        raise not_found("Документ")
    return await file_response(database, await database.documents.find_one({"_id": oid(doc_id)}))

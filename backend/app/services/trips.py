"""Бізнес-логіка рейсів: номер, історія змін, оплата, клієнт, стан машини й водія, передача колезі.

Використовується роутером /trips і переходом користувача в іншу компанію (/company/switch).
"""
from datetime import date, timedelta

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter
from ..errors import ApiError, invalid
from ..utils import iso, is_oid, now, oid
from .crud import find_ref

DEFAULT_PAYMENT_DAYS = 14
# Поля, зміни яких записуються в історію рейсу (контракт, розділ 2)
TRACKED = ("price", "loadDate", "unloadDate", "driverId", "vehicleId", "distanceKm")
# Стани машини, коли вона зайнята рейсом (менеджер перемикає їх вручну під час рейсу)
VEHICLE_BUSY = ("loading", "on_trip", "unloaded")
VEHICLE_UNAVAILABLE = {"broken": "зламалась", "repair": "на ремонті"}


async def next_trip_number(database: AsyncDatabase, company_id) -> str:
    company = await database.companies.find_one_and_update(
        {"_id": company_id}, {"$inc": {"tripCounter": 1}}, return_document=ReturnDocument.AFTER
    )
    return f"TR-{(company or {}).get('tripCounter', 1):04d}"


# ---------- Історія ----------
def history_entry(user_id: str, action: str, **extra) -> dict:
    """Запис історії рейсу. Час — ISO-рядком: history віддається як є, без перетворення дат."""
    return {"at": iso(now()), "by": user_id, "action": action, **extra}


def _route(trip: dict) -> str:
    return f"{(trip.get('from') or {}).get('city', '')} → {(trip.get('to') or {}).get('city', '')}"


def changes_history(user_id: str, old: dict, new: dict) -> list[dict]:
    """Що записати в історію після PUT: статус, оплата й зміни ключових полів."""
    entries = []
    if new.get("status") != old.get("status"):
        entries.append(history_entry(user_id, "status", to=new.get("status")))
    changes = [{"field": k, "from": old.get(k), "to": new.get(k)} for k in TRACKED if old.get(k) != new.get(k)]
    if _route(old) != _route(new):
        changes.append({"field": "route", "from": _route(old), "to": _route(new)})
    if changes:
        entries.append(history_entry(user_id, "updated", changes=changes))
    was_paid = bool((old.get("payment") or {}).get("paidAt"))
    is_paid = bool((new.get("payment") or {}).get("paidAt"))
    if was_paid != is_paid:
        entries.append(history_entry(user_id, "paid" if is_paid else "unpaid"))
    return entries


# ---------- Клієнт і оплата ----------
async def apply_client(database: AsyncDatabase, user: dict, data: dict) -> dict | None:
    """clientId → знімок client { name, phone } у рейсі. Повертає клієнта (для відстрочки оплати)."""
    client_id = data.get("clientId")
    if not client_id:
        return None
    client = await find_ref(database, user, "clients", client_id)
    if client is None:
        raise invalid("Клієнта не знайдено у вашій компанії", "invalid_reference")
    data["client"] = {"name": client.get("name", ""), "phone": client.get("phone")}
    return client


def default_due_date(trip: dict, client: dict | None) -> str:
    """Термін оплати за замовчуванням: розвантаження (або завантаження) + відстрочка клієнта (14 днів)."""
    days = (client or {}).get("paymentDays")
    base = date.fromisoformat(trip.get("unloadDate") or trip["loadDate"])
    return (base + timedelta(days=DEFAULT_PAYMENT_DAYS if days is None else int(days))).isoformat()


# ---------- Машина й водій ----------
async def check_vehicle_available(database: AsyncDatabase, user: dict, vehicle_id: str | None) -> None:
    """Зламану чи ремонтовану машину на рейс не ставимо (409 vehicle_unavailable)."""
    if not vehicle_id:
        return
    vehicle = await find_ref(database, user, "vehicles", vehicle_id, {"plate": 1, "status": 1})
    state = VEHICLE_UNAVAILABLE.get((vehicle or {}).get("status"))
    if state:
        raise ApiError(409, f"Машина {vehicle.get('plate', '')} {state} — оберіть іншу", "vehicle_unavailable")


async def _busy_elsewhere(database: AsyncDatabase, user: dict, key: str, ref: str, trip_id) -> bool:
    return bool(await database.trips.find_one(
        {**company_filter(user), key: ref, "status": "in_progress", "_id": {"$ne": trip_id}}, {"_id": 1}
    ))


async def _set_resources(database: AsyncDatabase, user: dict, trip: dict, *, busy: bool) -> None:
    """busy=True — рейс поїхав: машина й водій on_trip. busy=False — рейс завершено/скасовано/видалено:
    звільняємо їх, якщо в них немає іншого рейсу в дорозі. Зламану машину й водія у вихідний не чіпаємо."""
    moment = now()
    for collection, key in (("vehicles", "vehicleId"), ("drivers", "driverId")):
        ref = trip.get(key)
        if not is_oid(ref) or (not busy and await _busy_elsewhere(database, user, key, ref, trip.get("_id"))):
            continue
        query = {"_id": oid(ref), **company_filter(user)}
        if collection == "vehicles":
            # «на завантаженні» / «розвантажилась» менеджер ставить сам — при старті рейсу їх не перебиваємо
            query["status"] = {"$in": ["available"]} if busy else {"$in": list(VEHICLE_BUSY)}
            update = {"status": "on_trip" if busy else "available", "statusUpdatedAt": moment}
        else:
            query["status"] = {"$ne": "day_off"} if busy else "on_trip"
            update = {"status": "on_trip" if busy else "available"}
        await database[collection].update_one(query, {"$set": update})


async def sync_resources(database: AsyncDatabase, user: dict, old: dict | None, new: dict | None) -> None:
    """Статус рейсу керує станом машини й водія. old — рейс до змін (None при створенні),
    new — після (None при видаленні)."""
    old_active = bool(old) and old.get("status") == "in_progress"
    new_active = bool(new) and new.get("status") == "in_progress"
    refs_changed = bool(old and new) and any(old.get(k) != new.get(k) for k in ("vehicleId", "driverId"))
    if old_active and (not new_active or refs_changed):
        await _set_resources(database, user, old, busy=False)
    if new_active and (not old_active or refs_changed):
        await _set_resources(database, user, new, busy=True)


# ---------- Передача колезі ----------
async def transfer(database: AsyncDatabase, trip: dict, *, by: str, to: str, comment: str = "") -> dict:
    """Змінює відповідального менеджера, пише історію й системне повідомлення в чат компанії."""
    moment = now()
    doc = await database.trips.find_one_and_update(
        {"_id": trip["_id"]},
        {
            "$set": {"managerId": to, "transferredAt": moment, "transferredFrom": trip.get("managerId")},
            "$push": {"history": history_entry(by, "transferred", **{"from": trip.get("managerId"), "to": to})},
        },
        return_document=ReturnDocument.AFTER,
    )
    await database.messages.insert_one({
        "companyId": trip["companyId"], "type": "transfer", "authorId": by, "tripId": str(trip["_id"]),
        "toId": to, "text": comment, "createdAt": moment,
    })
    return doc

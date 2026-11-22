"""Робота з користувачами та компаніями, спільна для всіх способів входу."""
import re
import secrets
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..schemas.auth import AuthResponse, UserOut
from ..security import create_token
from ..errors import ApiError
from ..utils import now, squash

# Скільки часу після підтвердження пошти / входу можна прив'язати телефон через публічні ендпоінти
PHONE_SETUP_WINDOW = timedelta(minutes=30)


def member_status(user: dict) -> str | None:
    """Статус менеджера в компанії: pending | active | rejected (старі записи без поля — active). Власнику — None."""
    if user.get("role") == "owner":
        return None
    return user.get("memberStatus") or "active"


def default_settings() -> dict:
    # fuelPrice: None — рахувати за ринковою ціною дизеля (GET /fuel-price); число — власна ціна менеджера
    return {"viberTemplate": None, "pushEnabled": True, "soundEnabled": False, "fuelPrice": None}


def new_user_doc(*, name: str, email: str, **extra) -> dict:
    moment = now()
    doc = {
        "name": name,
        "email": email,
        "passwordHash": None,
        "phone": None,
        "phoneVerified": False,
        "emailVerified": False,
        "companyId": None,
        "role": "manager",
        "position": "Менеджер з вантажоперевезень",
        "avatarUrl": None,
        "language": "uk",
        "settings": default_settings(),
        "createdAt": moment,
        "lastSeenAt": None,
    }
    doc.update(extra)
    return doc


# ---------- Компанії ----------
def normalize_company_code(raw: str | None) -> str:
    """«nvp4821», « NVP-4821 » → «NVP-4821» (як formatCompanyCode на фронті)."""
    s = re.sub(r"[^A-Z0-9]", "", (raw or "").upper())[:7]
    return f"{s[:3]}-{s[3:]}" if len(s) > 3 else s


async def company_code_ok(db: AsyncDatabase, user: dict, raw_code: str | None) -> bool:
    """Код компанії при вході менеджера: має збігатися з актуальним кодом його компанії.
    Відхиленому менеджеру підходить і код іншої компанії — він увійде й подасть туди заявку."""
    code = normalize_company_code(raw_code)
    if not code:
        return False
    company = await db.companies.find_one({"_id": user.get("companyId")}, {"inviteCode": 1}) if user.get("companyId") else None
    if company and company.get("inviteCode") == code:
        return True
    return member_status(user) == "rejected" and await db.companies.find_one({"inviteCode": code}, {"_id": 1}) is not None


def _invite_code() -> str:
    return f"NVP-{secrets.randbelow(9000) + 1000}"


async def unique_invite_code(db: AsyncDatabase) -> str:
    for _ in range(50):
        code = _invite_code()
        if not await db.companies.find_one({"inviteCode": code}, {"_id": 1}):
            return code
    raise RuntimeError("Не вдалося згенерувати унікальний код запрошення")


async def create_company(db: AsyncDatabase, name: str, owner_id, city: str | None = None) -> dict:
    for _ in range(5):
        doc = {"name": name, "inviteCode": await unique_invite_code(db), "city": city,
               "ownerId": owner_id, "createdAt": now(), "tripCounter": 0}
        try:
            result = await db.companies.insert_one(doc)
        except DuplicateKeyError:
            continue
        doc["_id"] = result.inserted_id
        return doc
    raise RuntimeError("Не вдалося створити компанію")


async def resolve_company_choice(db: AsyncDatabase, choice, user_name: str) -> dict:
    """{ mode: 'create', name } / { mode: 'join', code } з форми → що зберегти/виконати:
    { mode: 'create', name } або { mode: 'join', companyId }. Невідомий код — 404 company_not_found."""
    if choice is None:
        return {"mode": "create", "name": f"Компанія {user_name}"}
    if choice.mode == "join":
        company = await db.companies.find_one({"inviteCode": normalize_company_code(choice.code)}, {"_id": 1})
        if company is None:
            raise ApiError(404, "Компанію з таким кодом не знайдено. Перевірте код у власника", "company_not_found")
        return {"mode": "join", "companyId": company["_id"]}
    return {"mode": "create", "name": squash(choice.name), "city": squash(choice.city) or None}


async def attach_company(db: AsyncDatabase, user: dict, choice: dict | None) -> dict:
    """Прив'язує користувача до компанії: нова (він — власник) або існуюча за кодом — тоді він менеджер
    зі статусом pending, доки власник не прийме заявку."""
    choice = choice or {"mode": "create", "name": f"Компанія {user['name']}"}
    company = None
    if choice.get("mode") == "join" and choice.get("companyId"):
        company = await db.companies.find_one({"_id": choice["companyId"]})
    if company is None:
        company = await create_company(db, choice.get("name") or f"Компанія {user['name']}", user["_id"], choice.get("city"))
        role, status = "owner", None
    else:
        role, status = "manager", "pending"
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"companyId": company["_id"], "role": role, "memberStatus": status},
         "$unset": {"pendingCompany": "", "removedAt": ""}},
    )
    user.update(companyId=company["_id"], role=role, memberStatus=status)
    user.pop("removedAt", None)
    user.pop("pendingCompany", None)
    return company


async def ensure_company(db: AsyncDatabase, user: dict) -> None:
    """Компанію обрано під час реєстрації (pendingCompany), пошту підтверджено, а компанії немає —
    створюємо/приєднуємо. Новим користувачам Google компанію обирає сам користувач
    на кроці «Завершіть реєстрацію», тож без pendingCompany нічого не робимо."""
    if user.get("emailVerified") and user.get("companyId") is None and user.get("pendingCompany"):
        await attach_company(db, user, user["pendingCompany"])


# ---------- Відповіді ----------
async def user_out(db: AsyncDatabase, user: dict) -> UserOut:
    company = await db.companies.find_one({"_id": user.get("companyId")}, {"name": 1}) if user.get("companyId") else None
    return UserOut(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        phone=user.get("phone"),
        phone_verified=bool(user.get("phoneVerified")),
        role=user.get("role"),
        member_status=member_status(user),
        company_id=str(user["companyId"]) if user.get("companyId") else None,
        company_name=company["name"] if company else None,
        position=user.get("position"),
        avatar_url=user.get("avatarUrl"),
    )


async def auth_response(db: AsyncDatabase, user: dict, *, is_new: bool = False) -> AuthResponse:
    """Видає токен. Якщо телефон ще не підтверджено — відкриває «вікно» для його прив'язки."""
    await ensure_company(db, user)
    update = {"lastSeenAt": now()}
    if not user.get("phoneVerified"):
        update["phoneSetupUntil"] = now() + PHONE_SETUP_WINDOW
    await db.users.update_one({"_id": user["_id"]}, {"$set": update})
    return AuthResponse(token=create_token(str(user["_id"])), user=await user_out(db, user), is_new=is_new)


# ---------- Заявки на вступ ----------
async def open_join_request(db: AsyncDatabase, user: dict) -> None:
    """Заявка менеджера власнику компанії (після підтвердження телефону). Попередні незакриті — скасовуємо."""
    await db.join_requests.update_many({"userId": user["_id"], "status": "pending"}, {"$set": {"status": "cancelled"}})
    await db.join_requests.insert_one({"companyId": user["companyId"], "userId": user["_id"], "status": "pending",
                                       "createdAt": now()})


async def release_phone_from_unverified(db: AsyncDatabase, phone: str, except_id=None) -> bool:
    """Номер зайнятий підтвердженим користувачем → True. Якщо його «тримає» незавершена реєстрація — звільняємо."""
    holder = await db.users.find_one({"phone": phone, "_id": {"$ne": except_id}})
    if holder is None:
        return False
    if holder.get("emailVerified") and holder.get("phoneVerified"):
        return True
    if not holder.get("emailVerified"):
        await db.users.update_one({"_id": holder["_id"]}, {"$set": {"phone": None}})
        return False
    return True

"""Робота з користувачами та компаніями, спільна для всіх способів входу."""
import secrets
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..config import settings
from ..schemas.auth import AuthResponse, UserOut
from ..security import create_token
from ..utils import now

# Скільки часу після підтвердження пошти / входу можна прив'язати телефон через публічні ендпоінти
PHONE_SETUP_WINDOW = timedelta(minutes=30)


def default_settings() -> dict:
    return {"viberTemplate": None, "pushEnabled": True, "soundEnabled": False, "fuelPrice": settings.default_fuel_price}


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


async def attach_company(db: AsyncDatabase, user: dict, choice: dict | None) -> dict:
    """Прив'язує користувача до компанії: нова (він — власник) або існуюча (за кодом)."""
    choice = choice or {"mode": "create", "name": f"Компанія {user['name']}"}
    company = None
    if choice.get("mode") == "join" and choice.get("companyId"):
        company = await db.companies.find_one({"_id": choice["companyId"]})
    if company is None:
        company = await create_company(db, choice.get("name") or f"Компанія {user['name']}", user["_id"])
        role = "owner"
    else:
        role = "manager"
    await db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"companyId": company["_id"], "role": role}, "$unset": {"pendingCompany": ""}},
    )
    user.update(companyId=company["_id"], role=role)
    user.pop("pendingCompany", None)
    return company


# ---------- Відповіді ----------
async def user_out(db: AsyncDatabase, user: dict) -> UserOut:
    company = await db.companies.find_one({"_id": user.get("companyId")}, {"name": 1}) if user.get("companyId") else None
    return UserOut(
        id=str(user["_id"]),
        name=user["name"],
        email=user["email"],
        phone=user.get("phone"),
        phone_verified=bool(user.get("phoneVerified")),
        role=user.get("role", "manager"),
        company_id=str(user.get("companyId") or ""),
        company_name=company["name"] if company else None,
        position=user.get("position"),
        avatar_url=user.get("avatarUrl"),
    )


async def auth_response(db: AsyncDatabase, user: dict) -> AuthResponse:
    """Видає токен. Якщо телефон ще не підтверджено — відкриває «вікно» для його прив'язки."""
    update = {"lastSeenAt": now()}
    if not user.get("phoneVerified"):
        update["phoneSetupUntil"] = now() + PHONE_SETUP_WINDOW
    await db.users.update_one({"_id": user["_id"]}, {"$set": update})
    return AuthResponse(token=create_token(str(user["_id"])), user=await user_out(db, user))


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

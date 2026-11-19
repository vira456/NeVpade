"""Залежності FastAPI: поточний користувач за Bearer-токеном."""
from datetime import timedelta

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase

from .db import get_db
from .errors import ApiError
from .security import decode_token
from .services.users import ensure_company, member_status
from .utils import is_oid, now, oid

_bearer = HTTPBearer(auto_error=False)

# Як часто оновлювати «останню активність» (для статусу «в мережі»)
_SEEN_THROTTLE = timedelta(seconds=30)


def db() -> AsyncDatabase:
    return get_db()


async def _token_user(creds: HTTPAuthorizationCredentials | None, database: AsyncDatabase) -> dict | None:
    """Користувач за Bearer-токеном або None, якщо заголовка немає чи токен недійсний."""
    if creds is None or creds.scheme.lower() != "bearer":
        return None
    user_id = decode_token(creds.credentials)
    if not user_id or not is_oid(user_id):
        return None
    return await database.users.find_one({"_id": oid(user_id)})


async def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: AsyncDatabase = Depends(db),
) -> dict | None:
    """Для публічних ендпоінтів, які поводяться інакше, якщо користувач уже увійшов."""
    return await _token_user(creds, database)


async def any_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: AsyncDatabase = Depends(db),
) -> dict:
    """Увійшов, але телефон може бути ще не підтверджений (напр. після входу через Google)."""
    if creds is None:
        raise ApiError(401, "Потрібна авторизація", "unauthorized")
    user = await _token_user(creds, database)
    if user is None or not user.get("emailVerified"):
        raise ApiError(401, "Сесія завершилась. Увійдіть знову", "token_invalid")
    # Компанію обрано під час реєстрації, але її не створено (запит verify-email обірвався тощо) — довиконуємо
    await ensure_company(database, user)

    moment = now()
    last = user.get("lastSeenAt")
    if last is None or moment - last > _SEEN_THROTTLE:
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"lastSeenAt": moment}})
        user["lastSeenAt"] = moment
    return user


async def current_user(user: dict = Depends(any_user)) -> dict:
    """Доступ до даних — лише після завершеної реєстрації: є компанія й підтверджений телефон.
    До того працюють тільки /auth/me, /auth/complete-signup, /auth/phone, /auth/verify-phone, /auth/resend-code."""
    if user.get("companyId") is None or not user.get("phoneVerified"):
        raise ApiError(403, "Завершіть реєстрацію: оберіть компанію й підтвердьте телефон", "signup_incomplete")
    if member_status(user) in ("pending", "rejected"):  # власник статусу не має, менеджер — лише active
        raise ApiError(403, "Заявка на вступ ще чекає підтвердження власника компанії", "membership_pending")
    return user


def is_owner(user: dict) -> bool:
    return user.get("role") == "owner"


def require_owner(user: dict, detail: str = "Ця дія доступна лише власнику компанії") -> None:
    if not is_owner(user):
        raise ApiError(403, detail, "owner_only")


def require_manager(user: dict) -> None:
    """Власник лише переглядає роботу компанії; рейси, автопарк, водіїв і клієнтів веде менеджер."""
    if is_owner(user):
        raise ApiError(403, "Власник переглядає дані компанії, а змінює їх менеджер", "manager_only")


async def owner_user(user: dict = Depends(current_user)) -> dict:
    require_owner(user)
    return user


async def manager_user(user: dict = Depends(current_user)) -> dict:
    require_manager(user)
    return user


def company_filter(user: dict) -> dict:
    """Фільтр «лише дані компанії поточного користувача»."""
    return {"companyId": user["companyId"]}

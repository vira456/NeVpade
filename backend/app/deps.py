"""Залежності FastAPI: поточний користувач за Bearer-токеном."""
from datetime import timedelta

from fastapi import Depends  # pyright: ignore[reportMissingImports]
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase  # pyright: ignore[reportMissingImports]

from .db import get_db
from .errors import ApiError
from .security import decode_token
from .utils import is_oid, now, oid

_bearer = HTTPBearer(auto_error=False)

# Як часто оновлювати «останню активність» (для статусу «в мережі»)
_SEEN_THROTTLE = timedelta(seconds=30)


def db() -> AsyncDatabase:
    return get_db()


async def optional_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: AsyncDatabase = Depends(db),
) -> dict | None:
    """Користувач з токена, якщо заголовок Authorization є і токен дійсний; інакше None (для публічних ендпоінтів)."""
    if creds is None or creds.scheme.lower() != "bearer":
        return None
    user_id = decode_token(creds.credentials)
    if not user_id or not is_oid(user_id):
        return None
    return await database.users.find_one({"_id": oid(user_id)})


async def any_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    database: AsyncDatabase = Depends(db),
) -> dict:
    """Увійшов, але телефон може бути ще не підтверджений (напр. після входу через Google)."""
    if creds is None or creds.scheme.lower() != "bearer":
        raise ApiError(401, "Потрібна авторизація", "unauthorized")
    user_id = decode_token(creds.credentials)
    if not user_id or not is_oid(user_id):
        raise ApiError(401, "Сесія завершилась. Увійдіть знову", "token_invalid")
    user = await database.users.find_one({"_id": oid(user_id)})
    if user is None or not user.get("emailVerified"):
        raise ApiError(401, "Сесія завершилась. Увійдіть знову", "token_invalid")
    if user.get("companyId") is None:
        raise ApiError(403, "Користувач не належить до жодної компанії", "no_company")

    moment = now()
    last = user.get("lastSeenAt")
    if last is None or moment - last > _SEEN_THROTTLE:
        await database.users.update_one({"_id": user["_id"]}, {"$set": {"lastSeenAt": moment}})
        user["lastSeenAt"] = moment
    return user


async def current_user(user: dict = Depends(any_user)) -> dict:
    """Повноцінний доступ до даних — лише з підтвердженим телефоном (контракт, розділ 1)."""
    if not user.get("phoneVerified"):
        raise ApiError(403, "Підтвердьте номер телефону, щоб продовжити", "phone_not_verified")
    return user


def company_filter(user: dict) -> dict:
    """Фільтр «лише дані компанії поточного користувача»."""
    return {"companyId": user["companyId"]}

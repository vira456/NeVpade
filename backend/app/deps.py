"""Залежності FastAPI: поточний користувач за Bearer-токеном."""
from datetime import timedelta

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pymongo.asynchronous.database import AsyncDatabase

from .db import get_db
from .errors import ApiError
from .security import decode_token
from .services.users import ensure_company
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
    # Пошту підтверджено, а компанії немає (напр. запит verify-email обірвався або запис правили вручну) —
    # довиконуємо цей крок за вибором, який користувач зробив під час реєстрації
    await ensure_company(database, user)

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

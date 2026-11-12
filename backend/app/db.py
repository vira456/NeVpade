"""Підключення до MongoDB (Atlas) через асинхронний клієнт PyMongo."""
import logging

import certifi
from pymongo import ASCENDING, DESCENDING, AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from .config import settings

log = logging.getLogger("nevpade.db")

_client: AsyncMongoClient | None = None
_db: AsyncDatabase | None = None


async def connect() -> None:
    global _client, _db
    if not settings.mongodb_uri:
        raise RuntimeError("Не задано MONGODB_URI. Додайте рядок підключення до MongoDB Atlas у backend/.env")
    kwargs = {"tz_aware": True, "serverSelectionTimeoutMS": 10_000}
    if settings.mongodb_uri.startswith("mongodb+srv://"):
        kwargs["tlsCAFile"] = certifi.where()  # щоб TLS до Atlas працював на Windows/macOS
    _client = AsyncMongoClient(settings.mongodb_uri, **kwargs)
    _db = _client[settings.mongodb_db]
    await _client.admin.command("ping")
    await _create_indexes(_db)
    log.info("MongoDB: підключено до бази «%s»", settings.mongodb_db)


async def close() -> None:
    global _client, _db
    if _client is not None:
        await _client.close()
    _client = None
    _db = None


def get_db() -> AsyncDatabase:
    if _db is None:
        raise RuntimeError("База даних ще не підключена")
    return _db


async def _create_indexes(db: AsyncDatabase) -> None:
    await db.users.create_index("email", unique=True)
    await db.users.create_index("phone", unique=True, partialFilterExpression={"phone": {"$type": "string"}})
    await db.users.create_index("googleId", sparse=True)
    await db.users.create_index("facebookId", sparse=True)
    await db.users.create_index("companyId")

    await db.companies.create_index("inviteCode", unique=True)

    # Коди підтвердження: Mongo сам видаляє прострочені записи (TTL-індекс)
    await db.codes.create_index([("email", ASCENDING), ("purpose", ASCENDING)], unique=True)
    await db.codes.create_index("expiresAt", expireAfterSeconds=0)

    await db.trips.create_index([("companyId", ASCENDING), ("loadDate", DESCENDING)])
    await db.trips.create_index([("companyId", ASCENDING), ("number", ASCENDING)])
    await db.vehicles.create_index("companyId")
    await db.drivers.create_index("companyId")
    await db.tasks.create_index([("ownerId", ASCENDING), ("status", ASCENDING), ("order", ASCENDING)])
    await db.messages.create_index([("companyId", ASCENDING), ("_id", ASCENDING)])

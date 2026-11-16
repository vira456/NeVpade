"""Одноразові 6-значні коди (пошта, телефон, відновлення пароля).

Вимоги з контракту: код з пошти дійсний 10 хвилин, з SMS — 5, у БД — лише хеш, максимум 5 спроб,
повторне надсилання не частіше ніж раз на 60 с, після використання код видаляється.
"""
from datetime import timedelta

from pymongo.asynchronous.database import AsyncDatabase

from ..errors import ApiError
from ..security import codes_equal, generate_code, hash_code
from ..utils import now

CODE_TTL = timedelta(minutes=10)
SMS_CODE_TTL = timedelta(minutes=5)
RESEND_COOLDOWN = timedelta(seconds=60)
MAX_ATTEMPTS = 5

PURPOSES = ("verify", "verify_phone", "reset")


async def issue(db: AsyncDatabase, email: str, purpose: str, *, enforce_cooldown: bool = True) -> str:
    """Створює новий код (старий перестає діяти) і повертає його для надсилання."""
    moment = now()
    existing = await db.codes.find_one({"email": email, "purpose": purpose})
    if enforce_cooldown and existing and moment - existing["createdAt"] < RESEND_COOLDOWN:
        wait = int((RESEND_COOLDOWN - (moment - existing["createdAt"])).total_seconds()) + 1
        raise ApiError(429, f"Новий код можна запросити через {wait} с", "too_many_requests")

    code = generate_code()
    await db.codes.update_one(
        {"email": email, "purpose": purpose},
        {"$set": {"codeHash": hash_code(code, email, purpose), "createdAt": moment,
                  "expiresAt": moment + (SMS_CODE_TTL if purpose == "verify_phone" else CODE_TTL), "attempts": 0}},
        upsert=True,
    )
    return code


async def consume(db: AsyncDatabase, email: str, purpose: str, code: str) -> None:
    """Перевіряє код. Якщо правильний — видаляє його, інакше кидає ApiError."""
    doc = await db.codes.find_one({"email": email, "purpose": purpose})
    if doc is None or doc["expiresAt"] <= now():
        raise ApiError(400, "Термін дії коду минув. Запросіть новий код", "code_expired")
    if doc.get("attempts", 0) >= MAX_ATTEMPTS:
        raise ApiError(429, "Забагато невдалих спроб. Запросіть новий код", "too_many_attempts")

    if not codes_equal(doc["codeHash"], hash_code(code.strip(), email, purpose)):
        await db.codes.update_one({"_id": doc["_id"]}, {"$inc": {"attempts": 1}})
        raise ApiError(400, "Невірний код підтвердження", "invalid_code")

    await db.codes.delete_one({"_id": doc["_id"]})

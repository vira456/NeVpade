"""Код власника — другий фактор входу в кабінет власника (контракт, розділ 1).

Формат OWN-XXXX-XXXX: 8 символів з алфавіту без схожих знаків (0/O, 1/I/L), криптографічний генератор.
У базі — лише bcrypt-хеш (як пароль); відкритий код показується людині один раз.
"""
import re
import secrets

from pymongo.asynchronous.database import AsyncDatabase

from ..security import hash_password, verify_password

ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"


def generate() -> str:
    raw = "".join(secrets.choice(ALPHABET) for _ in range(8))
    return f"OWN-{raw[:4]}-{raw[4:]}"


def normalize(value: str | None) -> str | None:
    """«own 7k3p92qx», «OWN-7K3P-92QX», «7k3p-92qx» → «OWN-7K3P-92QX»; інше — None."""
    chars = re.sub(r"[^A-Za-z0-9]", "", value or "").upper()
    chars = chars.removeprefix("OWN")
    if len(chars) != 8:
        return None
    return f"OWN-{chars[:4]}-{chars[4:]}"


def matches(value: str | None, hashed: str | None) -> bool:
    code = normalize(value)
    return bool(code and hashed and verify_password(code, hashed))


async def issue(database: AsyncDatabase, user: dict) -> str:
    """Новий код власника (старий перестає діяти). Повертає відкритий код — показати/надіслати один раз."""
    code = generate()
    hashed = hash_password(code)
    await database.users.update_one({"_id": user["_id"]}, {"$set": {"ownerCodeHash": hashed},
                                                             "$unset": {"ownerLoginFails": "", "ownerLockUntil": ""}})
    user["ownerCodeHash"] = hashed
    return code

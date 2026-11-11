"""Допоміжні функції: ObjectId ↔ рядковий id, час, номери телефонів."""
import re
from datetime import datetime, timezone
from typing import Any

from bson import ObjectId
from bson.errors import InvalidId

from .errors import not_found


def now() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime | None) -> str | None:
    """Дата й час у форматі контракту: 2026-11-09T10:00:00Z."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def oid(value: str, what: str = "Запис") -> ObjectId:
    """Рядок → ObjectId. Некоректний id означає, що такого запису немає (404)."""
    try:
        return ObjectId(value)
    except (InvalidId, TypeError):
        raise not_found(what) from None


def is_oid(value: Any) -> bool:
    return isinstance(value, str) and ObjectId.is_valid(value)


def public(doc: dict | None, *hidden: str) -> dict | None:
    """Документ з MongoDB → JSON для фронту: `_id` стає рядковим `id`, службові поля прибираються,
    дати перетворюються на ISO-рядки."""
    if doc is None:
        return None
    out: dict[str, Any] = {"id": str(doc["_id"])}
    for key, value in doc.items():
        if key == "_id" or key in hidden or key == "companyId":
            continue
        if isinstance(value, ObjectId):
            value = str(value)
        elif isinstance(value, datetime):
            value = iso(value)
        out[key] = value
    return out


def regex_escape(text: str) -> str:
    return re.escape(text.strip())


_PHONE_RE = re.compile(r"^\+380\d{9}$")


def normalize_phone(raw: str) -> str:
    """Будь-який запис українського номера → +380XXXXXXXXX."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "38" + digits
    elif digits.startswith("80") and len(digits) == 11:
        digits = "3" + digits
    phone = "+" + digits
    if not _PHONE_RE.match(phone):
        raise ValueError("Введіть український номер у форматі +380XXXXXXXXX")
    return phone


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}***@{domain}"

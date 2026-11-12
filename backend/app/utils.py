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


def drop_nulls(data: dict, nullable: set[str] | frozenset[str] = frozenset()) -> dict:
    """Прибирає з оновлення `null` для обов'язкових полів (інакше в базі з'явився б зіпсований запис).
    Поля з `nullable` можна явно очистити, передавши `null`."""
    return {k: v for k, v in data.items() if v is not None or k in nullable}


def regex_escape(text: str) -> str:
    return re.escape(text.strip())


# Лише мобільні коди українських операторів (як у контракті й валідації фронтенду)
_PHONE_RE = re.compile(r"^\+380(39|50|63|66|67|68|73|89|9[1-9])\d{7}$")


def normalize_phone(raw: str) -> str:
    """Будь-який запис українського номера → +380XXXXXXXXX."""
    digits = re.sub(r"\D", "", raw or "")
    if digits.startswith("0") and len(digits) == 10:
        digits = "38" + digits
    elif digits.startswith("80") and len(digits) == 11:
        digits = "3" + digits
    phone = "+" + digits
    if not _PHONE_RE.match(phone):
        raise ValueError("Введіть український мобільний номер у форматі +380XXXXXXXXX")
    return phone


def normalize_optional_phone(raw: str | None) -> str | None:
    """Те саме, але порожнє значення → None (напр. необов'язковий Viber)."""
    if raw is None or not str(raw).strip():
        return None
    return normalize_phone(raw)


# Ім'я: слова з українських/латинських літер, апостроф і дефіс лише всередині слова
_WORD = r"[A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]+(?:['’ʼ-][A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії]+)*"
_WORD_RE = re.compile(rf"^{_WORD}$")


def normalize_name(raw: str, *, min_words: int, max_words: int, max_len: int) -> str:
    """«  Олена   Коваль » → «Олена Коваль»; перевіряє кількість слів і символи."""
    name = " ".join(str(raw or "").split())
    words = name.split(" ") if name else []
    if len(name) > max_len:
        raise ValueError(f"Ім'я занадто довге (максимум {max_len} символів)")
    if not (min_words <= len(words) <= max_words) or not all(_WORD_RE.match(w) and len(w) >= 2 for w in words):
        if min_words == max_words == 2:
            raise ValueError("Вкажіть ім'я та прізвище через пробіл (лише літери, апостроф і дефіс)")
        raise ValueError("Вкажіть прізвище, ім'я та (за бажанням) по батькові — лише літери, апостроф і дефіс")
    return name


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:2]}***@{domain}"

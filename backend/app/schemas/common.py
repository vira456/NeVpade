"""Базові моделі та спільні валідатори."""
import re
from datetime import date
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from ..utils import normalize_phone

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_PASSWORD_LETTER = re.compile(r"[A-Za-zА-Яа-яІіЇїЄєҐґ]")
_PASSWORD_DIGIT = re.compile(r"\d")


class CamelModel(BaseModel):
    """У Python — snake_case, у JSON — camelCase (як у контракті)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, str_strip_whitespace=True)


def _email(value: str) -> str:
    value = value.strip().lower()
    if len(value) > 254 or not _EMAIL_RE.match(value):
        raise ValueError("Введіть коректний email")
    return value


def _password(value: str) -> str:
    if len(value) < 8:
        raise ValueError("Пароль має містити щонайменше 8 символів")
    if len(value) > 128:
        raise ValueError("Пароль занадто довгий")
    if not _PASSWORD_LETTER.search(value) or not _PASSWORD_DIGIT.search(value):
        raise ValueError("Пароль має містити хоча б одну літеру й одну цифру")
    return value


def _date(value: str | None) -> str | None:
    if value in (None, ""):
        return None
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("Дата має бути у форматі YYYY-MM-DD") from None
    return value


def _code(value: str) -> str:
    value = value.strip()
    if not re.fullmatch(r"\d{6}", value):
        raise ValueError("Код має складатися з 6 цифр")
    return value


Email = Annotated[str, AfterValidator(_email)]
Password = Annotated[str, AfterValidator(_password)]
Phone = Annotated[str, AfterValidator(normalize_phone)]
IsoDate = Annotated[str | None, AfterValidator(_date)]
Code = Annotated[str, AfterValidator(_code)]


class Message(BaseModel):
    message: str

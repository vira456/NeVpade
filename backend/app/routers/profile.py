"""Профіль менеджера: особисті дані, фото, KPI, налаштування сповіщень."""
import base64
import re
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field, field_validator
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import company_filter, current_user, db
from ..errors import ApiError
from ..schemas.common import CamelModel, Email, Phone
from ..services.users import default_settings

router = APIRouter(prefix="/profile", tags=["Профіль"])

MAX_AVATAR_BYTES = 300 * 1024  # фронт і так стискає фото до 256×256
_DATA_URL = re.compile(r"^data:image/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$")


class ProfileOut(CamelModel):
    id: str
    full_name: str
    position: str | None = None
    email: str
    phone: str | None = None
    language: str = "uk"
    avatar_url: str | None = None


class ProfileUpdate(CamelModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=100)
    position: str | None = Field(default=None, max_length=100)
    email: Email | None = None
    phone: Phone | None = None
    language: Literal["uk", "en"] | None = None


class AvatarIn(CamelModel):
    image: str = Field(max_length=MAX_AVATAR_BYTES * 2)

    @field_validator("image")
    @classmethod
    def _check(cls, value: str) -> str:
        match = _DATA_URL.match(value)
        if not match:
            raise ValueError("Фото має бути зображенням PNG, JPEG або WebP")
        try:
            raw = base64.b64decode(match.group(2), validate=True)
        except ValueError:
            raise ValueError("Пошкоджене зображення") from None
        if len(raw) > MAX_AVATAR_BYTES:
            raise ValueError("Фото завелике (максимум 300 КБ)")
        return value


class SettingsOut(CamelModel):
    viber_template: str | None = None
    push_enabled: bool = True
    sound_enabled: bool = False
    fuel_price: float


class SettingsUpdate(CamelModel):
    viber_template: str | None = Field(default=None, max_length=2000)
    push_enabled: bool | None = None
    sound_enabled: bool | None = None
    fuel_price: float | None = Field(default=None, gt=0, le=1000)


class KpiOut(CamelModel):
    trips_count: int
    rating: float
    rating_max: int = 5
    active_drivers: int


def profile_out(user: dict) -> ProfileOut:
    return ProfileOut(
        id=str(user["_id"]), full_name=user["name"], position=user.get("position"), email=user["email"],
        phone=user.get("phone"), language=user.get("language", "uk"), avatar_url=user.get("avatarUrl"),
    )


async def _set(database: AsyncDatabase, user: dict, fields: dict) -> dict:
    return await database.users.find_one_and_update({"_id": user["_id"]}, {"$set": fields}, return_document=ReturnDocument.AFTER)


@router.get("", response_model=ProfileOut)
async def get_profile(user: dict = Depends(current_user)):
    return profile_out(user)


@router.put("", response_model=ProfileOut)
async def update_profile(body: ProfileUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    data = body.model_dump(exclude_unset=True, exclude_none=True)
    fields: dict = {}
    if "full_name" in data:
        fields["name"] = " ".join(data["full_name"].split())
    for key in ("position", "language"):
        if key in data:
            fields[key] = data[key]
    if "email" in data and data["email"] != user["email"]:
        if await database.users.find_one({"email": data["email"], "_id": {"$ne": user["_id"]}}, {"_id": 1}):
            raise ApiError(409, "Цей email уже використовується", "email_taken")
        fields["email"] = data["email"]
    if "phone" in data and data["phone"] != user.get("phone"):
        if await database.users.find_one({"phone": data["phone"], "_id": {"$ne": user["_id"]}}, {"_id": 1}):
            raise ApiError(409, "Цей номер уже використовується", "phone_taken")
        fields["phone"] = data["phone"]
    if not fields:
        return profile_out(user)
    try:
        updated = await _set(database, user, fields)
    except DuplicateKeyError as exc:
        code = "email_taken" if "email" in str(exc) else "phone_taken"
        raise ApiError(409, "Цей email уже використовується" if code == "email_taken" else "Цей номер уже використовується", code) from None
    return profile_out(updated)


@router.put("/avatar", response_model=ProfileOut)
async def update_avatar(body: AvatarIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    # Невелике фото зберігаємо прямо в документі користувача як data URL — фронт показує його без окремого сховища
    return profile_out(await _set(database, user, {"avatarUrl": body.image}))


@router.delete("/avatar", response_model=ProfileOut)
async def delete_avatar(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return profile_out(await _set(database, user, {"avatarUrl": None}))


@router.get("/kpi", response_model=KpiOut)
async def kpi(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    me = str(user["_id"])
    trips_count = await database.trips.count_documents({**company_filter(user), "managerId": me})
    done = await database.trips.count_documents({**company_filter(user), "managerId": me, "status": "done"})
    cancelled = await database.trips.count_documents({**company_filter(user), "managerId": me, "status": "cancelled"})
    # Рейтинг: частка успішно завершених рейсів серед закритих (завершені + скасовані), у шкалі 0–5
    rating = round(5 * done / (done + cancelled), 1) if done + cancelled else 5.0
    active_drivers = await database.drivers.count_documents({**company_filter(user), "status": {"$ne": "day_off"}})
    return KpiOut(trips_count=trips_count, rating=rating, active_drivers=active_drivers)


@router.get("/settings", response_model=SettingsOut)
async def get_settings(user: dict = Depends(current_user)):
    return {**default_settings(), **(user.get("settings") or {})}


@router.patch("/settings", response_model=SettingsOut)
async def update_settings(body: SettingsUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    patch = body.model_dump(by_alias=True, exclude_unset=True)
    if "fuelPrice" in patch and patch["fuelPrice"] is None:
        patch.pop("fuelPrice")
    for flag in ("pushEnabled", "soundEnabled"):
        if flag in patch and patch[flag] is None:
            patch.pop(flag)
    if patch:
        user = await _set(database, user, {f"settings.{k}": v for k, v in patch.items()})
    return {**default_settings(), **(user.get("settings") or {})}

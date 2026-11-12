"""Компанія поточного менеджера, її учасники та код запрошення."""
from datetime import timedelta

from fastapi import APIRouter, Depends
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import current_user, db
from ..errors import ApiError, not_found
from ..schemas.common import CamelModel
from ..services.users import unique_invite_code
from ..utils import iso, now

router = APIRouter(prefix="/company", tags=["Компанія"])

ONLINE_WINDOW = timedelta(minutes=2)  # «в мережі» — були запити останні ~2 хв


class CompanyOut(CamelModel):
    id: str
    name: str
    invite_code: str
    city: str | None = None
    created_at: str | None = None


class CompanyUpdate(CamelModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    city: str | None = Field(default=None, max_length=80)


class MemberOut(CamelModel):
    id: str
    name: str
    position: str | None = None
    email: str
    phone: str | None = None
    avatar_url: str | None = None
    online: bool
    last_seen: str | None = None
    role: str


def company_out(c: dict) -> CompanyOut:
    return CompanyOut(id=str(c["_id"]), name=c["name"], invite_code=c["inviteCode"], city=c.get("city"), created_at=iso(c.get("createdAt")))


def _owner_only(user: dict) -> None:
    if user.get("role") != "owner":
        raise ApiError(403, "Це може зробити лише власник компанії", "owner_only")


async def _company(database: AsyncDatabase, user: dict) -> dict:
    company = await database.companies.find_one({"_id": user["companyId"]})
    if company is None:
        raise not_found("Компанію")
    return company


@router.get("", response_model=CompanyOut)
async def get_company(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return company_out(await _company(database, user))


@router.put("", response_model=CompanyOut)
async def update_company(body: CompanyUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    _owner_only(user)
    data = body.model_dump(exclude_unset=True)
    if data.get("name") is None:  # назву не можна стерти
        data.pop("name", None)
    else:
        data["name"] = " ".join(data["name"].split())
    if not data:  # порожній $set Mongo відхиляє з помилкою
        return company_out(await _company(database, user))
    company = await database.companies.find_one_and_update(
        {"_id": user["companyId"]}, {"$set": data}, return_document=ReturnDocument.AFTER
    )
    if company is None:
        raise not_found("Компанію")
    return company_out(company)


@router.get("/members", response_model=list[MemberOut])
async def members(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    moment = now()
    result = []
    cursor = database.users.find({"companyId": user["companyId"], "emailVerified": True}).sort("createdAt", 1)
    async for m in cursor:
        seen = m.get("lastSeenAt")
        result.append(MemberOut(
            id=str(m["_id"]), name=m["name"], position=m.get("position"), email=m["email"], phone=m.get("phone"),
            avatar_url=m.get("avatarUrl"), online=bool(seen and moment - seen < ONLINE_WINDOW),
            last_seen=iso(seen), role=m.get("role", "manager"),
        ))
    return result


@router.post("/invite")
async def regenerate_invite(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Новий код запрошення; старий перестає діяти. Відповідь: { inviteCode }."""
    _owner_only(user)
    for _ in range(5):
        code = await unique_invite_code(database)
        try:
            await database.companies.update_one({"_id": user["companyId"]}, {"$set": {"inviteCode": code}})
        except DuplicateKeyError:
            continue
        return {"inviteCode": code}
    raise ApiError(500, "Не вдалося згенерувати код. Спробуйте ще раз")

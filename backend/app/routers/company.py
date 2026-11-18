"""Компанія поточного менеджера: дані, учасники й ролі, код запрошення, перехід в іншу компанію."""
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import current_user, db, require_owner
from ..errors import ApiError, not_found
from ..schemas.auth import CompanyChoice, UserOut
from ..schemas.common import CamelModel
from ..services import trips as trip_svc
from ..services.kpi import manager_kpi
from ..services.users import attach_company, resolve_company_choice, unique_invite_code, user_out
from ..utils import iso, is_oid, now, oid, squash

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
    role: str | None = None


class MemberKpiOut(CamelModel):
    trips_count: int
    trips_this_month: int
    paid_on_time: int | None = None
    active_drivers: int
    active_trips: int
    revenue_this_month: int


class RoleIn(CamelModel):
    role: Literal["owner", "manager"]


class SwitchIn(CamelModel):
    company: CompanyChoice


class SwitchOut(CamelModel):
    user: UserOut
    company: CompanyOut


def company_out(c: dict) -> CompanyOut:
    return CompanyOut(id=str(c["_id"]), name=c["name"], invite_code=c["inviteCode"], city=c.get("city"),
                      created_at=iso(c.get("createdAt")))


def member_out(m: dict) -> MemberOut:
    seen = m.get("lastSeenAt")
    return MemberOut(
        id=str(m["_id"]), name=m["name"], position=m.get("position"), email=m["email"], phone=m.get("phone"),
        avatar_url=m.get("avatarUrl"), online=bool(seen and now() - seen < ONLINE_WINDOW),
        last_seen=iso(seen), role=m.get("role"),
    )


def _members_query(company_id) -> dict:
    return {"companyId": company_id, "emailVerified": True}


async def _company(database: AsyncDatabase, company_id) -> dict:
    company = await database.companies.find_one({"_id": company_id})
    if company is None:
        raise not_found("Компанію")
    return company


async def _member(database: AsyncDatabase, user: dict, member_id: str) -> dict:
    member = (await database.users.find_one({"_id": oid(member_id), **_members_query(user["companyId"])})
              if is_oid(member_id) else None)
    if member is None:
        raise ApiError(404, "Такого колеги в компанії немає", "member_not_found")
    return member


# ---------- Компанія ----------
@router.get("", response_model=CompanyOut)
async def get_company(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return company_out(await _company(database, user["companyId"]))


@router.put("", response_model=CompanyOut)
async def update_company(body: CompanyUpdate, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    require_owner(user)
    data = body.model_dump(exclude_unset=True)
    if data.get("name") is None:  # назву не можна стерти
        data.pop("name", None)
    else:
        data["name"] = squash(data["name"])
    if not data:  # порожній $set Mongo відхиляє з помилкою
        return company_out(await _company(database, user["companyId"]))
    company = await database.companies.find_one_and_update(
        {"_id": user["companyId"]}, {"$set": data}, return_document=ReturnDocument.AFTER
    )
    if company is None:
        raise not_found("Компанію")
    return company_out(company)


@router.post("/invite")
async def regenerate_invite(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Новий код запрошення; старий перестає діяти. Відповідь: { inviteCode }."""
    require_owner(user)
    for _ in range(5):
        code = await unique_invite_code(database)
        try:
            await database.companies.update_one({"_id": user["companyId"]}, {"$set": {"inviteCode": code}})
        except DuplicateKeyError:
            continue
        return {"inviteCode": code}
    raise ApiError(500, "Не вдалося згенерувати код. Спробуйте ще раз")


# ---------- Учасники й ролі ----------
@router.get("/members", response_model=list[MemberOut])
async def members(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    cursor = database.users.find(_members_query(user["companyId"])).sort("createdAt", 1)
    return [member_out(m) async for m in cursor]


@router.get("/members/{member_id}", response_model=MemberOut)
async def member(member_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return member_out(await _member(database, user, member_id))


@router.get("/members/{member_id}/kpi", response_model=MemberKpiOut)
async def member_kpi(member_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    colleague = await _member(database, user, member_id)
    return await manager_kpi(database, user["companyId"], str(colleague["_id"]), extended=True)


@router.patch("/members/{member_id}/role", response_model=MemberOut)
async def set_role(member_id: str, body: RoleIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Призначити керівником або зробити менеджером (лише керівник; останнього керівника зняти не можна)."""
    require_owner(user, "Змінювати ролі може лише керівник")
    colleague = await _member(database, user, member_id)
    if body.role != "owner" and colleague.get("role") == "owner":
        others = {**_members_query(user["companyId"]), "role": "owner", "_id": {"$ne": colleague["_id"]}}
        if not await database.users.count_documents(others):
            raise ApiError(409, "У компанії має лишитися хоча б один керівник", "last_owner")
    updated = await database.users.find_one_and_update(
        {"_id": colleague["_id"]}, {"$set": {"role": body.role}}, return_document=ReturnDocument.AFTER
    )
    return member_out(updated)


# ---------- Перехід в іншу компанію ----------
@router.post("/switch", response_model=SwitchOut)
async def switch_company(body: SwitchIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Приєднатися до іншої компанії за кодом або створити нову. Активні рейси (planned, in_progress)
    передаються керівнику старої компанії, виконані лишаються в її історії."""
    old_company = user["companyId"]
    choice = await resolve_company_choice(database, body.company, user["name"])
    if choice["mode"] == "join" and choice["companyId"] == old_company:
        raise ApiError(409, "Ви вже в цій компанії", "same_company")

    colleagues = {**_members_query(old_company), "_id": {"$ne": user["_id"]}}
    successor = await database.users.find_one({**colleagues, "role": "owner"}, {"_id": 1})
    if user.get("role") == "owner" and successor is None and await database.users.count_documents(colleagues):
        raise ApiError(409, "Ви єдиний керівник компанії. Спершу призначте керівником когось із колег", "last_owner")

    if successor is not None:
        me = str(user["_id"])
        active = database.trips.find({"companyId": old_company, "managerId": me, "status": {"$in": ["planned", "in_progress"]}})
        async for trip in active:
            await trip_svc.transfer(database, trip, by=me, to=str(successor["_id"]), comment="Менеджер перейшов в іншу компанію")

    company = await attach_company(database, user, choice)
    return SwitchOut(user=await user_out(database, user), company=company_out(company))

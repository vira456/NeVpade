"""Компанія: дані, учасники, заявки на вступ; кабінет власника (назва, код компанії, звільнення менеджера);
перехід менеджера в іншу компанію."""
from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import Field
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError

from ..deps import any_user, current_user, db, owner_user, require_manager
from ..errors import ApiError, invalid, not_found
from ..schemas.auth import CompanyChoice, UserOut
from ..schemas.common import CamelModel
from ..services import trips as trip_svc
from ..services.kpi import manager_kpi
from ..services.users import attach_company, open_join_request, resolve_company_choice, unique_invite_code, user_out
from ..utils import iso, is_oid, now, oid, squash

router = APIRouter(prefix="/company", tags=["Компанія"])

ONLINE_WINDOW = timedelta(minutes=2)  # «в мережі» — були запити останні ~2 хв
ACTIVE_TRIPS = ["planned", "in_progress"]


class CompanyOut(CamelModel):
    id: str
    name: str
    invite_code: str | None = None  # бачить лише власник
    city: str | None = None
    created_at: str | None = None


class CompanyUpdate(CamelModel):
    name: str | None = Field(default=None, max_length=120)
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


class JoinRequestOut(CamelModel):
    id: str
    user_id: str
    name: str
    email: str
    phone: str | None = None
    created_at: str | None = None
    status: str


class SwitchIn(CamelModel):
    company: CompanyChoice


class SwitchOut(CamelModel):
    user: UserOut
    company: CompanyOut


def company_out(c: dict, user: dict) -> CompanyOut:
    return CompanyOut(id=str(c["_id"]), name=c["name"], city=c.get("city"), created_at=iso(c.get("createdAt")),
                      invite_code=c["inviteCode"] if user.get("role") == "owner" else None)


def member_out(m: dict) -> MemberOut:
    seen = m.get("lastSeenAt")
    return MemberOut(
        id=str(m["_id"]), name=m["name"], position=m.get("position"), email=m["email"], phone=m.get("phone"),
        avatar_url=m.get("avatarUrl"), online=bool(seen and now() - seen < ONLINE_WINDOW),
        last_seen=iso(seen), role=m.get("role"),
    )


def _members_query(company_id) -> dict:
    """Учасники компанії: власник і прийняті менеджери (заявки pending/rejected — окремо)."""
    return {"companyId": company_id, "emailVerified": True, "memberStatus": {"$nin": ["pending", "rejected"]}}


async def _company(database: AsyncDatabase, company_id) -> dict:
    company = await database.companies.find_one({"_id": company_id})
    if company is None:
        raise not_found("Компанію")
    return company


async def _member(database: AsyncDatabase, user: dict, member_id: str, *, managers_only: bool = False) -> dict:
    query = _members_query(user["companyId"])
    if managers_only:
        query["role"] = "manager"
    member = await database.users.find_one({"_id": oid(member_id), **query}) if is_oid(member_id) else None
    if member is None:
        raise ApiError(404, "Такого колеги в компанії немає", "member_not_found")
    return member


# ---------- Компанія ----------
@router.get("", response_model=CompanyOut)
async def get_company(user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return company_out(await _company(database, user["companyId"]), user)


@router.patch("", response_model=CompanyOut)
async def update_company(body: CompanyUpdate, user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    """Назва й місто компанії (лише власник)."""
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        data["name"] = squash(data["name"])
        if len(data["name"]) < 2:
            raise invalid("Назва компанії має містити щонайменше 2 символи", "invalid_name")
    if "city" in data:
        data["city"] = squash(data["city"]) or None
    if not data:  # порожній $set Mongo відхиляє з помилкою
        return company_out(await _company(database, user["companyId"]), user)
    company = await database.companies.find_one_and_update(
        {"_id": user["companyId"]}, {"$set": data}, return_document=ReturnDocument.AFTER
    )
    if company is None:
        raise not_found("Компанію")
    return company_out(company, user)


@router.put("", response_model=CompanyOut, include_in_schema=False)
async def update_company_put(body: CompanyUpdate, user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    """Старий PUT /company — те саме, що PATCH."""
    return await update_company(body, user, database)


@router.post("/invite")
async def regenerate_invite(user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    """Новий код компанії; старий одразу перестає діяти і для реєстрації, і для входу.
    Відкриті сесії менеджерів закриваються — далі вони входять уже з новим кодом. Відповідь: { inviteCode }."""
    for _ in range(5):
        code = await unique_invite_code(database)
        try:
            await database.companies.update_one({"_id": user["companyId"]}, {"$set": {"inviteCode": code}})
        except DuplicateKeyError:
            continue
        await database.users.update_many({"companyId": user["companyId"], "role": "manager"},
                                         {"$set": {"sessionsRevokedAt": now()}})
        return {"inviteCode": code}
    raise ApiError(500, "Не вдалося згенерувати код. Спробуйте ще раз")


# ---------- Учасники ----------
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


@router.delete("/members/{member_id}")
async def remove_member(member_id: str, transfer_to: str | None = Query(None, alias="transferTo"),
                        user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    """Прибрати менеджера з компанії. Його активні рейси переходять до transferTo. → { transferred }."""
    if member_id == str(user["_id"]):
        raise ApiError(409, "Себе прибрати не можна", "cannot_remove_self")
    gone = await _member(database, user, member_id, managers_only=True)
    active = await database.trips.find(
        {"companyId": user["companyId"], "managerId": member_id, "status": {"$in": ACTIVE_TRIPS}}
    ).to_list(None)
    if active and not transfer_to:
        raise ApiError(409, "Оберіть менеджера, якому перейдуть активні рейси", "transfer_required")
    if transfer_to:
        target = (await database.users.find_one({"_id": oid(transfer_to), **_members_query(user["companyId"]), "role": "manager"})
                  if is_oid(transfer_to) and transfer_to != member_id else None)
        if target is None:
            raise invalid("Рейси можна передати лише іншому менеджеру компанії", "invalid_transfer")
    for trip in active:
        await trip_svc.transfer(database, trip, by=str(user["_id"]), to=transfer_to, comment="Менеджера прибрано з компанії")
    await database.users.update_one({"_id": gone["_id"]}, {"$set": {"companyId": None, "role": None, "memberStatus": None,
                                                                   "removedAt": now()}})
    return {"transferred": len(active)}


# ---------- Заявки на вступ ----------
async def _pending_request(database: AsyncDatabase, user: dict, request_id: str) -> dict:
    req = (await database.join_requests.find_one({"_id": oid(request_id), "companyId": user["companyId"], "status": "pending"})
           if is_oid(request_id) else None)
    if req is None:
        raise ApiError(404, "Заявку не знайдено або її вже розглянуто", "request_not_found")
    return req


@router.get("/join-requests", response_model=list[JoinRequestOut])
async def join_requests(user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    requests = await database.join_requests.find({"companyId": user["companyId"], "status": "pending"}).sort("createdAt", 1).to_list(None)
    people = {u["_id"]: u async for u in database.users.find({"_id": {"$in": [r["userId"] for r in requests]}})}
    return [
        JoinRequestOut(id=str(r["_id"]), user_id=str(r["userId"]), name=people[r["userId"]]["name"],
                       email=people[r["userId"]]["email"], phone=people[r["userId"]].get("phone"),
                       created_at=iso(r.get("createdAt")), status=r["status"])
        for r in requests if r["userId"] in people
    ]


async def _decide(database: AsyncDatabase, user: dict, request_id: str, decision: str) -> dict:
    req = await _pending_request(database, user, request_id)
    await database.join_requests.update_one({"_id": req["_id"]}, {"$set": {"status": decision, "decidedAt": now(),
                                                                          "decidedBy": user["_id"]}})
    status = "active" if decision == "approved" else "rejected"
    return await database.users.find_one_and_update(
        {"_id": req["userId"], "companyId": user["companyId"]}, {"$set": {"memberStatus": status}},
        return_document=ReturnDocument.AFTER,
    )


@router.post("/join-requests/{request_id}/approve", response_model=MemberOut)
async def approve_request(request_id: str, user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    manager = await _decide(database, user, request_id, "approved")
    if manager is None:  # людина вже подала заявку в іншу компанію
        raise ApiError(404, "Заявку не знайдено або її вже розглянуто", "request_not_found")
    return member_out(manager)


@router.post("/join-requests/{request_id}/reject")
async def reject_request(request_id: str, user: dict = Depends(owner_user), database: AsyncDatabase = Depends(db)):
    await _decide(database, user, request_id, "rejected")
    return {"message": "Заявку відхилено"}


# ---------- Перехід менеджера в іншу компанію ----------
@router.post("/switch", response_model=SwitchOut)
async def switch_company(body: SwitchIn, user: dict = Depends(any_user), database: AsyncDatabase = Depends(db)):
    """Менеджер переходить в іншу компанію за кодом: доступ до старої закривається одразу, у нову — після
    рішення її власника. Активні рейси лишаються в старій компанії без менеджера (власник побачить їх)."""
    require_manager(user)
    if body.company.mode != "join":
        raise ApiError(400, "Нову компанію створює власник під час реєстрації", "owner_needs_password")
    old_company = user.get("companyId")
    choice = await resolve_company_choice(database, body.company, user["name"])
    if choice["companyId"] == old_company:
        raise ApiError(409, "Ви вже в цій компанії", "same_company")

    if old_company is not None:
        me = str(user["_id"])
        await database.trips.update_many(
            {"companyId": old_company, "managerId": me, "status": {"$in": ACTIVE_TRIPS}},
            {"$set": {"managerId": None, "transferredAt": now(), "transferredFrom": me},
             "$push": {"history": trip_svc.history_entry(me, "transferred", **{"from": me, "to": None})}},
        )
    company = await attach_company(database, user, choice)
    if user.get("phoneVerified"):
        await open_join_request(database, user)
    return SwitchOut(user=await user_out(database, user), company=company_out(company, user))

"""Розділ 2 контракту: рейси /trips (+ розрахунок, передача колезі, імпорт)."""
from typing import Literal

from fastapi import APIRouter, Depends, Query, Response, status
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..config import settings
from ..deps import company_filter, current_user, db
from ..errors import ApiError, not_found
from ..schemas.entities import (
    CalculationOut,
    TransferIn,
    TripImportIn,
    TripImportOut,
    TripIn,
    TripOut,
    TripUpdate,
)
from ..services.calc import calculate
from ..services.crud import ensure_ref
from ..utils import is_oid, now, oid, public, regex_escape

router = APIRouter(prefix="/trips", tags=["Рейси"])


def trip_out(doc: dict) -> dict:
    return public(doc, "createdBy", "updatedAt", "transferredFrom")


def fuel_price_for(user: dict) -> float:
    """Ціна пального з налаштувань менеджера або типова з конфігурації."""
    price = (user.get("settings") or {}).get("fuelPrice")
    return float(price) if price else settings.default_fuel_price


async def _get_trip(database: AsyncDatabase, user: dict, trip_id: str) -> dict:
    doc = await database.trips.find_one({"_id": oid(trip_id, "Рейс"), **company_filter(user)})
    if doc is None:
        raise not_found("Рейс")
    return doc


def _check_can_edit(user: dict, trip: dict) -> None:
    """Змінювати рейс може відповідальний менеджер або власник компанії."""
    if trip.get("managerId") != str(user["_id"]) and user.get("role") != "owner":
        raise ApiError(403, "Змінювати можна лише свої рейси", "not_owner")


async def _validate_refs(database: AsyncDatabase, user: dict, data: dict) -> None:
    if "vehicleId" in data:
        await ensure_ref(database, user, "vehicles", data["vehicleId"], "Автомобіль")
    if "driverId" in data:
        await ensure_ref(database, user, "drivers", data["driverId"], "Водія")


async def next_trip_number(database: AsyncDatabase, company_id) -> str:
    company = await database.companies.find_one_and_update(
        {"_id": company_id}, {"$inc": {"tripCounter": 1}}, return_document=ReturnDocument.AFTER
    )
    return f"TR-{company['tripCounter']:04d}"


async def _sync_resources(database: AsyncDatabase, user: dict, trip: dict) -> None:
    """Статус рейсу впливає на статус авто й водія: у дорозі → on_trip, завершено → available."""
    st = trip.get("status")
    if st == "in_progress":
        new, only_from = "on_trip", None
    elif st in ("done", "cancelled"):
        new, only_from = "available", "on_trip"
    else:
        return
    for collection, key in (("vehicles", "vehicleId"), ("drivers", "driverId")):
        ref = trip.get(key)
        if not is_oid(ref):
            continue
        query = {"_id": oid(ref), **company_filter(user)}
        if only_from:
            query["status"] = only_from
        await database[collection].update_one(query, {"$set": {"status": new}})


async def _insert_trip(database: AsyncDatabase, user: dict, data: dict) -> dict:
    if not data.get("number"):
        data["number"] = await next_trip_number(database, user["companyId"])
    doc = {**data, "companyId": user["companyId"], "managerId": str(user["_id"]), "createdAt": now(),
           "createdBy": user["_id"], "transferredAt": None}
    result = await database.trips.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


# ---------- CRUD ----------
@router.get("", response_model=list[TripOut])
async def list_trips(
    status_: Literal["planned", "in_progress", "done", "cancelled"] | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=100),
    mine: bool = False,
    user: dict = Depends(current_user),
    database: AsyncDatabase = Depends(db),
):
    query: dict = company_filter(user)
    if status_:
        query["status"] = status_
    if mine:
        query["managerId"] = str(user["_id"])
    if search and search.strip():
        rx = {"$regex": regex_escape(search), "$options": "i"}
        query["$or"] = [{"number": rx}, {"from.city": rx}, {"to.city": rx}, {"client.name": rx}, {"cargo.type": rx}]
    cursor = database.trips.find(query).sort([("loadDate", -1), ("_id", -1)])
    return [trip_out(doc) async for doc in cursor]


@router.get("/{trip_id}", response_model=TripOut)
async def get_trip(trip_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    return trip_out(await _get_trip(database, user, trip_id))


@router.post("", response_model=TripOut, status_code=status.HTTP_201_CREATED)
async def create_trip(body: TripIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    data = body.model_dump(by_alias=True)
    await _validate_refs(database, user, data)
    doc = await _insert_trip(database, user, data)
    await _sync_resources(database, user, doc)
    return trip_out(doc)


@router.put("/{trip_id}", response_model=TripOut)
async def update_trip(trip_id: str, body: TripUpdate, user: dict = Depends(current_user),
                      database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    _check_can_edit(user, trip)
    data = body.model_dump(by_alias=True, exclude_unset=True)
    if "number" in data and not data["number"]:
        data.pop("number")
    await _validate_refs(database, user, data)
    doc = await database.trips.find_one_and_update(
        {"_id": trip["_id"]}, {"$set": {**data, "updatedAt": now()}}, return_document=ReturnDocument.AFTER
    )
    if "status" in data and data["status"] != trip.get("status"):
        await _sync_resources(database, user, doc)
    return trip_out(doc)


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(trip_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    _check_can_edit(user, trip)
    await database.trips.delete_one({"_id": trip["_id"]})
    await database.tasks.update_many({"tripId": trip_id}, {"$set": {"tripId": None}})
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- Бізнес-операції ----------
@router.post("/{trip_id}/calculate", response_model=CalculationOut)
async def calculate_trip(trip_id: str, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    trip = await _get_trip(database, user, trip_id)
    vehicle = await database.vehicles.find_one({"_id": oid(trip["vehicleId"]), **company_filter(user)}) if is_oid(trip.get("vehicleId")) else None
    driver = await database.drivers.find_one({"_id": oid(trip["driverId"]), **company_filter(user)}) if is_oid(trip.get("driverId")) else None
    return calculate(trip, vehicle, driver, fuel_price_for(user))


@router.post("/{trip_id}/transfer", response_model=TripOut)
async def transfer_trip(trip_id: str, body: TransferIn, user: dict = Depends(current_user),
                        database: AsyncDatabase = Depends(db)):
    """Передати свій рейс іншому менеджеру компанії. У чат компанії додається системне повідомлення."""
    trip = await _get_trip(database, user, trip_id)
    me = str(user["_id"])
    if trip.get("managerId") != me:
        raise ApiError(403, "Передати можна лише свій рейс", "not_owner")
    if body.to_manager_id == me:
        raise ApiError(400, "Рейс уже ваш", "same_manager")
    target = await database.users.find_one(
        {"_id": oid(body.to_manager_id, "Менеджера"), **company_filter(user)}, {"_id": 1}
    ) if is_oid(body.to_manager_id) else None
    if target is None:
        raise ApiError(404, "Менеджера не знайдено у вашій компанії", "manager_not_found")

    moment = now()
    doc = await database.trips.find_one_and_update(
        {"_id": trip["_id"]},
        {"$set": {"managerId": body.to_manager_id, "transferredAt": moment, "transferredFrom": me}},
        return_document=ReturnDocument.AFTER,
    )
    await database.messages.insert_one({
        "companyId": user["companyId"], "type": "transfer", "authorId": me, "tripId": trip_id,
        "toId": body.to_manager_id, "text": body.comment, "createdAt": moment,
    })
    return trip_out(doc)


@router.post("/import", response_model=TripImportOut, status_code=status.HTTP_201_CREATED)
async def import_trips(body: TripImportIn, user: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """Імпорт рейсів, отриманих з логістичної платформи (парсер передає їх списком)."""
    if not body.trips:
        raise ApiError(400, "Немає рейсів для імпорту", "empty_import")
    created = []
    for trip in body.trips:
        data = trip.model_dump(by_alias=True)
        data["source"] = "import"
        await _validate_refs(database, user, data)
        created.append(trip_out(await _insert_trip(database, user, data)))
    return {"imported": len(created), "trips": created}

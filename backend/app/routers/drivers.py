"""Розділ 4 контракту: водії /drivers. Одна машина — один водій."""
from fastapi import Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..errors import ApiError, not_found
from ..schemas.entities import AssignVehicleIn, DriverIn, DriverOut, DriverUpdate
from ..services.crud import crud_router, ensure_ref, get_company_doc
from ..services.documents import delete_owner_documents
from ..utils import now, public


async def _validate(database: AsyncDatabase, user: dict, data: dict, existing: dict | None) -> None:
    if "name" in data:
        data["name"] = " ".join(data["name"].split())
    if "vehicleId" in data:
        await ensure_ref(database, user, "vehicles", data["vehicleId"], "Автомобіль")
    # Viber за замовчуванням = телефон, але лише коли viber явно передано порожнім (або це створення).
    # Інакше зміна телефону перезаписувала б уже вказаний окремий номер Viber.
    if "viber" in data and not data["viber"]:
        data["viber"] = data.get("phone") or (existing or {}).get("phone")


async def release_vehicle(database: AsyncDatabase, user: dict, vehicle_id: str | None, except_driver) -> None:
    """Машину закріпили за водієм — у попереднього водія її знімаємо."""
    if vehicle_id:
        await database.drivers.update_many(
            {**company_filter(user), "vehicleId": vehicle_id, "_id": {"$ne": except_driver}}, {"$set": {"vehicleId": None}}
        )


async def _after_write(database: AsyncDatabase, user: dict, doc: dict) -> None:
    await release_vehicle(database, user, doc.get("vehicleId"), doc["_id"])


async def _before_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    active = await database.trips.find_one(
        {**company_filter(user), "driverId": str(doc["_id"]), "status": "in_progress"}, {"number": 1}
    )
    if active:
        raise ApiError(409, f"Водій зараз у рейсі {active.get('number', '')}. Спершу завершіть або змініть рейс.", "driver_busy")


async def _after_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    driver_id = str(doc["_id"])
    await database.trips.update_many({**company_filter(user), "driverId": driver_id, "status": "planned"},
                                     {"$set": {"driverId": None}})
    await delete_owner_documents(database, user["companyId"], "drivers", driver_id)


router = crud_router(
    collection="drivers",
    prefix="/drivers",
    tag="Водії",
    in_model=DriverIn,
    update_model=DriverUpdate,
    out_model=DriverOut,
    what="Водія",
    validate=_validate,
    after_write=_after_write,
    before_delete=_before_delete,
    after_delete=_after_delete,
    nullable=frozenset({"viber", "vehicleId"}),
)


@router.put("/{item_id}/vehicle", response_model=DriverOut)
async def assign_vehicle(item_id: str, body: AssignVehicleIn, user: dict = Depends(current_user),
                         database: AsyncDatabase = Depends(db)):
    """Закріпити машину за водієм ({ vehicleId: null } — відкріпити)."""
    driver = await get_company_doc(database, user, "drivers", item_id, "Водія")
    vehicle_id = body.vehicle_id or None
    await ensure_ref(database, user, "vehicles", vehicle_id, "Автомобіль")
    doc = await database.drivers.find_one_and_update(
        {"_id": driver["_id"]}, {"$set": {"vehicleId": vehicle_id, "updatedAt": now()}}, return_document=ReturnDocument.AFTER
    )
    if doc is None:
        raise not_found("Водія")
    await release_vehicle(database, user, vehicle_id, doc["_id"])
    return public(doc)

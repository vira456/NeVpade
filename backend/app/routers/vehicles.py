"""Розділ 3 контракту: автопарк /vehicles."""
import re

from fastapi import Depends
from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..errors import ApiError, not_found
from ..schemas.entities import VehicleIn, VehicleOut, VehicleStatusIn, VehicleUpdate
from ..services.crud import crud_router, get_company_doc
from ..services.documents import delete_owner_documents
from ..utils import now, public


def plate_key(plate: str) -> str:
    """«вх 1234 ак» і «ВХ1234АК» — той самий номер: без пробілів/дефісів, великими літерами."""
    return re.sub(r"[\s\-]", "", plate or "").upper()


async def _validate(database: AsyncDatabase, user: dict, data: dict, existing: dict | None) -> None:
    if "plate" in data:
        data["plate"] = " ".join(data["plate"].split()).upper()
        key = plate_key(data["plate"])
        query = company_filter(user)
        if existing is not None:
            query = {**query, "_id": {"$ne": existing["_id"]}}
        # Автопарк компанії невеликий, тож порівнюємо нормалізовані номери прямо тут
        async for other in database.vehicles.find(query, {"plate": 1}):
            if plate_key(other.get("plate", "")) == key:
                raise ApiError(409, "Машина з таким номером уже є в автопарку", "plate_taken")
    # statusUpdatedAt сервер ставить сам при кожній зміні стану
    if "status" in data and (existing is None or existing.get("status") != data["status"]):
        data["statusUpdatedAt"] = now()


async def _before_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    active = await database.trips.find_one(
        {**company_filter(user), "vehicleId": str(doc["_id"]), "status": "in_progress"}, {"number": 1}
    )
    if active:
        raise ApiError(409, f"Машина зараз у рейсі {active.get('number', '')}. Спершу завершіть або змініть рейс.", "vehicle_busy")


async def _after_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    vehicle_id = str(doc["_id"])
    # Знімаємо машину із запланованих рейсів і з водія; завершені рейси зберігають історію
    await database.trips.update_many({**company_filter(user), "vehicleId": vehicle_id, "status": "planned"},
                                     {"$set": {"vehicleId": None}})
    await database.drivers.update_many({**company_filter(user), "vehicleId": vehicle_id}, {"$set": {"vehicleId": None}})
    await delete_owner_documents(database, user["companyId"], "vehicles", vehicle_id)


router = crud_router(
    collection="vehicles",
    prefix="/vehicles",
    tag="Автопарк",
    in_model=VehicleIn,
    update_model=VehicleUpdate,
    out_model=VehicleOut,
    what="Машину",
    validate=_validate,
    before_delete=_before_delete,
    after_delete=_after_delete,
    nullable=frozenset({"nextServiceKm", "insuranceUntil"}),
)


@router.patch("/{item_id}/status", response_model=VehicleOut)
async def set_status(item_id: str, body: VehicleStatusIn, user: dict = Depends(current_user),
                     database: AsyncDatabase = Depends(db)):
    """Швидка зміна стану: на завантаженні / в дорозі / розвантажилась / зламалась / на ремонті / вільна."""
    vehicle = await get_company_doc(database, user, "vehicles", item_id, "Машину")
    fields = {"status": body.status}
    if vehicle.get("status") != body.status:
        fields["statusUpdatedAt"] = now()
    doc = await database.vehicles.find_one_and_update(
        {"_id": vehicle["_id"]}, {"$set": {**fields, "updatedAt": now()}}, return_document=ReturnDocument.AFTER
    )
    if doc is None:
        raise not_found("Машину")
    return public(doc)

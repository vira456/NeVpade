"""Розділ 3 контракту: автопарк /vehicles."""
from pymongo.asynchronous.database import AsyncDatabase

from ..schemas.entities import VehicleIn, VehicleOut, VehicleUpdate
from ..services.crud import crud_router


async def _on_delete(database: AsyncDatabase, user: dict, doc: dict) -> None:
    # Водії, закріплені за видаленим авто, лишаються без авто
    await database.drivers.update_many(
        {"companyId": user["companyId"], "vehicleId": str(doc["_id"])}, {"$set": {"vehicleId": None}}
    )


router = crud_router(
    collection="vehicles",
    prefix="/vehicles",
    tag="Автопарк",
    in_model=VehicleIn,
    update_model=VehicleUpdate,
    out_model=VehicleOut,
    what="Автомобіль",
    on_delete=_on_delete,
    nullable=frozenset({"nextServiceKm", "insuranceUntil"}),
)

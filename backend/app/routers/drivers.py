"""Розділ 4 контракту: водії /drivers."""
from pymongo.asynchronous.database import AsyncDatabase

from ..schemas.entities import DriverIn, DriverOut, DriverUpdate
from ..services.crud import crud_router, ensure_ref


async def _validate(database: AsyncDatabase, user: dict, data: dict) -> None:
    if "vehicleId" in data:
        await ensure_ref(database, user, "vehicles", data["vehicleId"], "Автомобіль")
    if not data.get("viber") and data.get("phone"):
        data["viber"] = data["phone"]


router = crud_router(
    collection="drivers",
    prefix="/drivers",
    tag="Водії",
    in_model=DriverIn,
    update_model=DriverUpdate,
    out_model=DriverOut,
    what="Водія",
    validate=_validate,
)

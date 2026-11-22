"""Ринкова ціна пального: GET /fuel-price (середня ціна дизеля по АЗС України, оновлюється раз на 12 год)."""
from fastapi import APIRouter, Depends
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import current_user, db
from ..schemas.common import CamelModel
from ..services.fuel import market_price

router = APIRouter(tags=["Пальне"])


class FuelPriceOut(CamelModel):
    diesel: float  # грн/л
    date: str | None = None  # на яку дату ціна (за даними джерела)
    source: str | None = None
    source_url: str | None = None
    updated_at: str | None = None  # коли сервер востаннє отримав ціну
    is_fallback: bool = False  # True — джерело недоступне, це типова ціна з налаштувань сервера


@router.get("/fuel-price", response_model=FuelPriceOut)
async def fuel_price(_: dict = Depends(current_user), database: AsyncDatabase = Depends(db)):
    """{ diesel, date, source, sourceUrl, updatedAt, isFallback }. Розрахунок рейсу й аналітика беруть цю ціну,
    якщо менеджер не вказав власну (PATCH /profile/settings { fuelPrice }; null — повернутися до ринкової)."""
    return await market_price(database)

"""Розділ 6 контракту: аналітика /analytics (рахується з рейсів компанії «на льоту»)."""
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..services.analytics import Analytics
from .trips import fuel_price_for

router = APIRouter(prefix="/analytics", tags=["Аналітика"])

KYIV = ZoneInfo("Europe/Kyiv")
PeriodQuery = Query("month", description="week | month | year")


async def _analytics(user: dict, database: AsyncDatabase) -> Analytics:
    flt = company_filter(user)
    trips = await database.trips.find(flt, {"loadDate": 1, "price": 1, "distanceKm": 1, "status": 1, "vehicleId": 1, "driverId": 1}).to_list(None)
    vehicles = {str(v["_id"]): v async for v in database.vehicles.find(flt, {"fuelConsumption": 1})}
    drivers = {str(d["_id"]): d async for d in database.drivers.find(flt, {"name": 1, "ratePerKm": 1})}
    return Analytics(trips, vehicles, drivers, fuel_price_for(user), datetime.now(KYIV).date())


@router.get("/summary")
async def summary(period: Literal["week", "month", "year"] = PeriodQuery, user: dict = Depends(current_user),
                  database: AsyncDatabase = Depends(db)):
    """{ income, expenses, profit, tripsCount, distanceKm, previous: {...} } — previous для порівняння з минулим періодом."""
    return (await _analytics(user, database)).summary(period)


@router.get("/income")
async def income(period: Literal["week", "month", "year"] = PeriodQuery, user: dict = Depends(current_user),
                 database: AsyncDatabase = Depends(db)):
    """{ labels: [...], income: [...], expenses: [...] } для графіка."""
    return (await _analytics(user, database)).income(period)


@router.get("/expenses")
async def expenses(period: Literal["week", "month", "year"] = PeriodQuery, user: dict = Depends(current_user),
                   database: AsyncDatabase = Depends(db)):
    """{ fuel, salary, repair, tolls, other } — структура витрат."""
    return (await _analytics(user, database)).expenses(period)


@router.get("/drivers")
async def drivers(period: Literal["week", "month", "year"] = PeriodQuery, user: dict = Depends(current_user),
                  database: AsyncDatabase = Depends(db)):
    """[ { driverId, name, trips, income } ] — рейтинг водіїв за доходом."""
    return (await _analytics(user, database)).drivers_stats(period)

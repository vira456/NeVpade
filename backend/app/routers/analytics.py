"""Розділ 6 контракту: аналітика /analytics (рахується з рейсів компанії «на льоту»)."""
from fastapi import APIRouter, Depends, Query
from pymongo.asynchronous.database import AsyncDatabase

from ..deps import company_filter, current_user, db
from ..services.analytics import COUNTED, Analytics, Period, period_range, previous_range
from ..utils import today_kyiv
from .trips import fuel_price_for

router = APIRouter(prefix="/analytics", tags=["Аналітика"])

_TRIP_FIELDS = {"loadDate": 1, "price": 1, "distanceKm": 1, "status": 1, "vehicleId": 1, "driverId": 1}


async def _analytics(
    period: Period = Query("month", description="week | month | year"),
    user: dict = Depends(current_user),
    database: AsyncDatabase = Depends(db),
) -> tuple[Analytics, Period]:
    """Виконані й поточні рейси компанії за поточний і попередній період (не всю історію) + авто й водії."""
    today = today_kyiv()
    since = previous_range(period, today)[0].isoformat()
    until = period_range(period, today)[1].isoformat()
    flt = company_filter(user)
    trips = await database.trips.find(
        {**flt, "loadDate": {"$gte": since, "$lte": until}, "status": {"$in": list(COUNTED)}}, _TRIP_FIELDS
    ).to_list(None)
    vehicles = {str(v["_id"]): v async for v in database.vehicles.find(flt, {"fuelConsumption": 1})}
    drivers = {str(d["_id"]): d async for d in database.drivers.find(flt, {"name": 1, "ratePerKm": 1})}
    return Analytics(trips, vehicles, drivers, fuel_price_for(user), today), period


@router.get("/summary")
async def summary(ctx: tuple[Analytics, Period] = Depends(_analytics)):
    """{ income, expenses, profit, tripsCount, distanceKm, previous: {...} } — previous для порівняння з минулим періодом."""
    analytics, period = ctx
    return analytics.summary(period)


@router.get("/income")
async def income(ctx: tuple[Analytics, Period] = Depends(_analytics)):
    """{ labels: [...], income: [...], expenses: [...] } для графіка."""
    analytics, period = ctx
    return analytics.income(period)


@router.get("/expenses")
async def expenses(ctx: tuple[Analytics, Period] = Depends(_analytics)):
    """{ fuel, salary, repair, tolls, other } — структура витрат."""
    analytics, period = ctx
    return analytics.expenses(period)


@router.get("/drivers")
async def drivers(ctx: tuple[Analytics, Period] = Depends(_analytics)):
    """[ { driverId, name, trips, income } ] — рейтинг водіїв за доходом."""
    analytics, period = ctx
    return analytics.drivers_stats(period)

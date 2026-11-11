"""Аналітика: доходи, витрати, прибуток за тиждень / місяць / рік.

Рейс потрапляє в період за датою завантаження (loadDate). Скасовані рейси не враховуються.
Дохід рейсу — його ціна, витрати — собівартість за формулою з services/calc.py.
Усі функції тут «чисті» (без бази даних), тому їх легко тестувати.
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from .calc import calculate, expense_breakdown

Period = Literal["week", "month", "year"]

MONTHS_SHORT = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"]
MONTHS_GENITIVE_SHORT = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."]
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]


@dataclass(frozen=True)
class Bucket:
    label: str
    start: date
    end: date  # включно


def period_range(period: Period, today: date) -> tuple[date, date]:
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if period == "month":
        last = calendar.monthrange(today.year, today.month)[1]
        return today.replace(day=1), today.replace(day=last)
    return date(today.year, 1, 1), date(today.year, 12, 31)


def previous_range(period: Period, today: date) -> tuple[date, date]:
    start, _ = period_range(period, today)
    return period_range(period, start - timedelta(days=1))


def buckets(period: Period, today: date) -> list[Bucket]:
    start, end = period_range(period, today)
    if period == "week":
        return [Bucket(WEEKDAYS[i], start + timedelta(days=i), start + timedelta(days=i)) for i in range(7)]
    if period == "month":
        result, day = [], 1
        month_name = MONTHS_GENITIVE_SHORT[today.month - 1]
        while day <= end.day:
            last = end.day if day == 22 else min(day + 6, end.day)
            result.append(Bucket(f"{day}–{last} {month_name}", start.replace(day=day), start.replace(day=last)))
            day = last + 1
        return result
    # рік: місяці від січня до поточного
    return [
        Bucket(MONTHS_SHORT[m - 1], date(today.year, m, 1), date(today.year, m, calendar.monthrange(today.year, m)[1]))
        for m in range(1, today.month + 1)
    ]


def _in(trip: dict, start: date, end: date) -> bool:
    d = trip.get("loadDate") or ""
    return start.isoformat() <= d <= end.isoformat() and trip.get("status") != "cancelled"


class Analytics:
    """Обчислення над списком рейсів компанії."""

    def __init__(self, trips: list[dict], vehicles: dict[str, dict], drivers: dict[str, dict], fuel_price: float, today: date):
        self.trips = trips
        self.vehicles = vehicles
        self.drivers = drivers
        self.fuel_price = fuel_price
        self.today = today

    def _cost(self, trip: dict) -> int:
        return calculate(trip, self.vehicles.get(trip.get("vehicleId") or ""), self.drivers.get(trip.get("driverId") or ""), self.fuel_price)["totalCost"]

    def _totals(self, start: date, end: date) -> dict:
        selected = [t for t in self.trips if _in(t, start, end)]
        income = round(sum(float(t.get("price") or 0) for t in selected))
        expenses = sum(self._cost(t) for t in selected)
        return {
            "income": income,
            "expenses": expenses,
            "profit": income - expenses,
            "tripsCount": len(selected),
            "distanceKm": round(sum(float(t.get("distanceKm") or 0) for t in selected)),
        }

    def summary(self, period: Period) -> dict:
        return {**self._totals(*period_range(period, self.today)), "previous": self._totals(*previous_range(period, self.today))}

    def income(self, period: Period) -> dict:
        parts = buckets(period, self.today)
        totals = [self._totals(b.start, b.end) for b in parts]
        return {"labels": [b.label for b in parts], "income": [t["income"] for t in totals], "expenses": [t["expenses"] for t in totals]}

    def expenses(self, period: Period) -> dict:
        start, end = period_range(period, self.today)
        result = {"fuel": 0, "salary": 0, "repair": 0, "tolls": 0, "other": 0}
        for t in self.trips:
            if _in(t, start, end):
                part = expense_breakdown(t, self.vehicles.get(t.get("vehicleId") or ""), self.drivers.get(t.get("driverId") or ""), self.fuel_price)
                for key, value in part.items():
                    result[key] += value
        return result

    def drivers_stats(self, period: Period) -> list[dict]:
        start, end = period_range(period, self.today)
        stats: dict[str, dict] = {}
        for t in self.trips:
            driver_id = t.get("driverId")
            if not driver_id or not _in(t, start, end):
                continue
            row = stats.setdefault(driver_id, {"driverId": driver_id, "name": (self.drivers.get(driver_id) or {}).get("name", "—"), "trips": 0, "income": 0})
            row["trips"] += 1
            row["income"] += round(float(t.get("price") or 0))
        return sorted(stats.values(), key=lambda r: r["income"], reverse=True)

"""Аналітика: доходи, витрати, прибуток за тиждень / місяць / рік.

Рахуються рейси зі статусом done або in_progress (заплановані й скасовані — ні) за датою loadDate.
Дохід рейсу — його ціна, витрати — собівартість за формулою з services/calc.py.
Усі функції тут «чисті» (без бази даних), тому їх легко тестувати. Правила збігаються з фронтендом
(frontend/src/js/api/analytics.js), щоб у режимі моків і з сервером цифри були однакові.
"""
import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from .calc import expense_breakdown

Period = Literal["week", "month", "year"]
COUNTED = ("done", "in_progress")

MONTHS_SHORT = ["Січ", "Лют", "Бер", "Кві", "Тра", "Чер", "Лип", "Сер", "Вер", "Жов", "Лис", "Гру"]
MONTHS_GENITIVE_SHORT = ["січ.", "лют.", "бер.", "квіт.", "трав.", "черв.", "лип.", "серп.", "вер.", "жовт.", "лист.", "груд."]
WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"]
EXPENSE_KEYS = ("fuel", "salary", "repair", "tolls", "other")


@dataclass(frozen=True)
class Bucket:
    label: str
    start: date
    end: date  # включно


def _same_day(year: int, month: int, day: int) -> date:
    """Та сама дата в іншому місяці/році; 31 → останній день коротшого місяця, 29.02 → 28.02."""
    return date(year, month, min(day, calendar.monthrange(year, month)[1]))


def period_range(period: Period, today: date) -> tuple[date, date]:
    """Увесь поточний період: тиждень з понеділка, календарний місяць або рік."""
    if period == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if period == "month":
        return today.replace(day=1), _same_day(today.year, today.month, 31)
    return date(today.year, 1, 1), date(today.year, 12, 31)


def previous_range(period: Period, today: date) -> tuple[date, date]:
    """Такий самий відрізок попереднього періоду: 1–11 листопада → 1–11 жовтня (а не весь жовтень),
    інакше на початку місяця порівняння завжди було б «у мінус»."""
    if period == "week":
        start = today - timedelta(days=today.weekday() + 7)
        return start, today - timedelta(days=7)
    if period == "month":
        prev = today.replace(day=1) - timedelta(days=1)
        return prev.replace(day=1), _same_day(prev.year, prev.month, today.day)
    return date(today.year - 1, 1, 1), _same_day(today.year - 1, today.month, today.day)


def buckets(period: Period, today: date) -> list[Bucket]:
    """Відрізки графіка: дні тижня, тижні місяця (1–7, 8–14, …) або 12 місяців року."""
    start, end = period_range(period, today)
    if period == "week":
        return [Bucket(WEEKDAYS[i], start + timedelta(days=i), start + timedelta(days=i)) for i in range(7)]
    if period == "month":
        month_name = MONTHS_GENITIVE_SHORT[today.month - 1]
        result = []
        for day in range(1, end.day + 1, 7):
            last = min(day + 6, end.day)
            result.append(Bucket(f"{day}–{last} {month_name}", start.replace(day=day), start.replace(day=last)))
        return result
    return [Bucket(MONTHS_SHORT[m - 1], date(today.year, m, 1), _same_day(today.year, m, 31)) for m in range(1, 13)]


def _in(trip: dict, start: date, end: date) -> bool:
    return trip.get("status") in COUNTED and start.isoformat() <= (trip.get("loadDate") or "") <= end.isoformat()


class Analytics:
    """Обчислення над списком рейсів компанії."""

    def __init__(self, trips: list[dict], vehicles: dict[str, dict], drivers: dict[str, dict], fuel_price: float, today: date):
        self.today = today
        self.drivers = drivers
        # витрати кожного рейсу рахуємо один раз, а не для кожного відрізка графіка
        self.rows = [
            (t, expense_breakdown(t, vehicles.get(t.get("vehicleId") or ""), drivers.get(t.get("driverId") or ""), fuel_price))
            for t in trips
            if t.get("status") in COUNTED
        ]

    def select(self, start: date, end: date) -> list[tuple[dict, dict]]:
        return [(t, c) for t, c in self.rows if _in(t, start, end)]

    def _totals(self, start: date, end: date) -> dict:
        selected = self.select(start, end)
        income = round(sum(float(t.get("price") or 0) for t, _ in selected))
        expenses = sum(sum(c[k] for k in EXPENSE_KEYS) for _, c in selected)
        return {
            "income": income,
            "expenses": expenses,
            "profit": income - expenses,
            "tripsCount": len(selected),
            "distanceKm": round(sum(float(t.get("distanceKm") or 0) for t, _ in selected)),
        }

    def summary(self, period: Period) -> dict:
        return {**self._totals(*period_range(period, self.today)), "previous": self._totals(*previous_range(period, self.today))}

    def income(self, period: Period) -> dict:
        parts = buckets(period, self.today)
        # майбутні відрізки — null, а не 0, щоб лінія графіка не «падала» в нуль
        totals = [None if b.start > self.today else self._totals(b.start, b.end) for b in parts]
        return {
            "labels": [b.label for b in parts],
            "income": [t and t["income"] for t in totals],
            "expenses": [t and t["expenses"] for t in totals],
        }

    def expenses(self, period: Period) -> dict:
        result = dict.fromkeys(EXPENSE_KEYS, 0)
        for _, c in self.select(*period_range(period, self.today)):
            for key in EXPENSE_KEYS:
                result[key] += c[key]
        return result

    def drivers_stats(self, period: Period) -> list[dict]:
        stats: dict[str, dict] = {}
        for t, _ in self.select(*period_range(period, self.today)):
            driver_id = t.get("driverId")
            if not driver_id:
                continue
            row = stats.setdefault(driver_id, {"driverId": driver_id, "name": (self.drivers.get(driver_id) or {}).get("name", "—"),
                                               "trips": 0, "income": 0})
            row["trips"] += 1
            row["income"] += round(float(t.get("price") or 0))
        return sorted(stats.values(), key=lambda r: r["income"], reverse=True)


# ---------- Кабінет власника: компанія й кожен менеджер ----------
def payment_state(trip: dict, today: date) -> str | None:
    """Як на фронті (utils/format.js → paymentStatus): paid | overdue | pending; None — не рахуємо."""
    if trip.get("status") == "cancelled":
        return None
    payment = trip.get("payment") or {}
    if payment.get("paidAt"):
        return "paid"
    if not payment.get("dueDate"):
        return None
    return "overdue" if payment["dueDate"] < today.isoformat() else "pending"


def team_stats(analytics: Analytics, all_trips: list[dict], period: Period) -> dict:
    """GET /analytics/team. Показники за період — з рейсів done/in_progress; activeTrips, paidOnTime й
    прострочені оплати — за весь час (контракт, «Кабінет власника»)."""
    today = analytics.today
    period_rows = analytics.select(*period_range(period, today))

    def money(trips: list[dict]) -> int:
        return round(sum(float(t.get("price") or 0) for t in trips))

    states = [(t, payment_state(t, today)) for t in all_trips]
    pending = [t for t, s in states if s == "pending"]
    overdue = [t for t, s in states if s == "overdue"]

    managers = []
    for manager_id in sorted({t["managerId"] for t in all_trips if t.get("managerId")}):
        mine = [t for t in all_trips if t.get("managerId") == manager_id]
        rows = [(t, c) for t, c in period_rows if t.get("managerId") == manager_id]
        with_due = [t for t in mine if t.get("status") == "done" and (t.get("payment") or {}).get("dueDate")]
        on_time = sum(1 for t in with_due if t["payment"].get("paidAt") and t["payment"]["paidAt"] <= t["payment"]["dueDate"])
        late = [t for t in mine if payment_state(t, today) == "overdue"]
        income = money([t for t, _ in rows])
        managers.append({
            "managerId": manager_id,
            "activeTrips": sum(1 for t in mine if t.get("status") in ("planned", "in_progress")),
            "tripsCount": len(rows),
            "income": income,
            "profit": income - sum(sum(c[k] for k in EXPENSE_KEYS) for _, c in rows),
            "paidOnTime": round(100 * on_time / len(with_due)) if with_due else None,
            "overdueAmount": money(late),
            "overdueCount": len(late),
        })
    return {
        **analytics.summary(period),
        "payments": {"pending": money(pending), "pendingCount": len(pending),
                     "overdue": money(overdue), "overdueCount": len(overdue)},
        "managers": managers,
    }

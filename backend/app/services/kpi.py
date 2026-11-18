"""Показники менеджера (контракт: GET /profile/kpi і GET /company/members/{id}/kpi).

Рахуються з рейсів менеджера (managerId) одним запитом до бази:
- tripsCount — виконані (done) за весь час; tripsThisMonth — виконані з loadDate у поточному місяці
- paidOnTime — % виконаних рейсів із терміном оплати, оплачених не пізніше терміну; None, якщо таких немає
- activeDrivers — скільки різних водіїв зараз у рейсах менеджера (planned / in_progress)
Для колеги додатково: activeTrips (planned + in_progress) і revenueThisMonth (done + in_progress за місяць).
"""
from pymongo.asynchronous.database import AsyncDatabase

from ..utils import today_kyiv

ACTIVE = ("planned", "in_progress")
_FIELDS = {"status": 1, "loadDate": 1, "driverId": 1, "price": 1, "payment": 1}


async def manager_kpi(database: AsyncDatabase, company_id, manager_id: str, *, extended: bool = False) -> dict:
    trips = await database.trips.find({"companyId": company_id, "managerId": manager_id}, _FIELDS).to_list(None)
    month = today_kyiv().isoformat()[:7]  # «2026-11»
    this_month = [t for t in trips if (t.get("loadDate") or "").startswith(month)]
    done = [t for t in trips if t.get("status") == "done"]
    active = [t for t in trips if t.get("status") in ACTIVE]

    with_due = [(t.get("payment") or {}) for t in done if (t.get("payment") or {}).get("dueDate")]
    on_time = sum(1 for p in with_due if p.get("paidAt") and p["paidAt"] <= p["dueDate"])

    kpi = {
        "tripsCount": len(done),
        "tripsThisMonth": sum(1 for t in this_month if t.get("status") == "done"),
        "paidOnTime": round(100 * on_time / len(with_due)) if with_due else None,
        "activeDrivers": len({t["driverId"] for t in active if t.get("driverId")}),
    }
    if extended:
        kpi["activeTrips"] = len(active)
        kpi["revenueThisMonth"] = round(sum(float(t.get("price") or 0) for t in this_month if t.get("status") in ("done", "in_progress")))
    return kpi

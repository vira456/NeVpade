"""Бізнес-логіка розрахунку собівартості рейсу.

Формула узгоджена з фронтендом (frontend/src/js/utils/economics.js, контракт — «Розрахунок рейсу»):
  пальне, л   = відстань × витрата (л/100 км) / 100        (без машини — 32 л/100 км)
  пальне, грн = пальне, л × ціна пального                   (налаштування менеджера, типово 56 грн/л)
  ЗП водія    = відстань × ставка водія (грн/км)            (без водія — 10 грн/км)
  ремонт і ТО = відстань × 2,2 грн/км
  дороги      = відстань × 1,1 грн/км (стоянки, зважування)
  інше        = 350 грн на рейс (зв'язок, документи)
  собівартість = пальне + ЗП + ремонт + дороги + інше;  прибуток = ціна − собівартість
"""
DEFAULT_CONSUMPTION = 32.0  # л/100 км
DEFAULT_RATE = 10.0  # грн/км

REPAIR_PER_KM = 2.2
TOLLS_PER_KM = 1.1
OTHER_PER_TRIP = 350


def expense_breakdown(trip: dict, vehicle: dict | None, driver: dict | None, fuel_price: float) -> dict:
    """Витрати рейсу за статтями: { fuel, salary, repair, tolls, other } + fuelLiters."""
    km = float(trip.get("distanceKm") or 0)
    consumption = float((vehicle or {}).get("fuelConsumption") or DEFAULT_CONSUMPTION)
    rate = float((driver or {}).get("ratePerKm") or DEFAULT_RATE)
    fuel_liters = round(km * consumption / 100, 1)
    return {
        "fuelLiters": fuel_liters,
        "fuel": round(fuel_liters * fuel_price),
        "salary": round(km * rate),
        "repair": round(km * REPAIR_PER_KM),
        "tolls": round(km * TOLLS_PER_KM),
        "other": OTHER_PER_TRIP if km else 0,
    }


def calculate(trip: dict, vehicle: dict | None, driver: dict | None, fuel_price: float) -> dict:
    """Відповідь POST /trips/{id}/calculate."""
    c = expense_breakdown(trip, vehicle, driver, fuel_price)
    other_costs = c["repair"] + c["tolls"] + c["other"]
    total = c["fuel"] + c["salary"] + other_costs
    return {
        "distanceKm": float(trip.get("distanceKm") or 0),
        "fuelLiters": c["fuelLiters"],
        "fuelCost": c["fuel"],
        "driverSalary": c["salary"],
        "otherCosts": other_costs,
        "totalCost": total,
        "profit": round(float(trip.get("price") or 0)) - total,
    }

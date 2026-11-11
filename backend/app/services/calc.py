"""Бізнес-логіка розрахунку собівартості рейсу.

Формула (узгоджена з фронтендом):
  пальне, л     = відстань × витрата (л/100 км) / 100
  пальне, грн   = пальне, л × ціна пального (налаштування менеджера, типово 56 грн/л)
  ЗП водія      = відстань × ставка водія (грн/км)
  інші витрати  = відстань × 3,5 грн/км (дороги/стоянки 1,2 + ремонт/амортизація 1,3 + інше 1,0)
  собівартість  = пальне + ЗП + інші витрати
  прибуток      = ціна рейсу − собівартість
"""
DEFAULT_CONSUMPTION = 32.0  # л/100 км, якщо авто не призначене
DEFAULT_RATE = 10.0  # грн/км, якщо водія не призначено

TOLLS_PER_KM = 1.2
REPAIR_PER_KM = 1.3
OTHER_PER_KM = 1.0
OTHER_COSTS_PER_KM = TOLLS_PER_KM + REPAIR_PER_KM + OTHER_PER_KM  # 3.5


def calculate(trip: dict, vehicle: dict | None, driver: dict | None, fuel_price: float) -> dict:
    distance = float(trip.get("distanceKm") or 0)
    consumption = float((vehicle or {}).get("fuelConsumption") or DEFAULT_CONSUMPTION)
    rate = float((driver or {}).get("ratePerKm") or DEFAULT_RATE)

    fuel_liters = round(distance * consumption / 100, 1)
    fuel_cost = round(fuel_liters * fuel_price)
    driver_salary = round(distance * rate)
    other_costs = round(distance * OTHER_COSTS_PER_KM)
    total_cost = fuel_cost + driver_salary + other_costs
    return {
        "distanceKm": distance,
        "fuelLiters": fuel_liters,
        "fuelCost": fuel_cost,
        "driverSalary": driver_salary,
        "otherCosts": other_costs,
        "totalCost": total_cost,
        "profit": round(float(trip.get("price") or 0)) - total_cost,
    }


def expense_breakdown(trip: dict, vehicle: dict | None, driver: dict | None, fuel_price: float) -> dict:
    """Витрати рейсу за статтями — для аналітики (кругова діаграма витрат)."""
    c = calculate(trip, vehicle, driver, fuel_price)
    distance = c["distanceKm"]
    return {
        "fuel": c["fuelCost"],
        "salary": c["driverSalary"],
        "repair": round(distance * REPAIR_PER_KM),
        "tolls": round(distance * TOLLS_PER_KM),
        "other": round(distance * OTHER_PER_KM),
    }

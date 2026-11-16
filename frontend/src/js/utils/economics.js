// Собівартість рейсу — одна формула для розрахунку рейсу, аналітики й профілю.
// На сервері Іра рахує так само (див. docs/api-contract.md, «Розрахунок рейсу»).
export const FUEL_PRICE = 56; // грн/л дизеля
export const REPAIR_PER_KM = 2.2; // ремонт і ТО (амортизація), грн/км
export const TOLLS_PER_KM = 1.1; // дороги, стоянки, зважування, грн/км
export const OTHER_PER_TRIP = 350; // зв'язок, документи, дрібні витрати

/** Витрати рейсу за статтями. vehicle/driver можуть бути відсутні — тоді середні значення. */
export function tripCosts(trip, vehicle, driver) {
  const km = trip.distanceKm || 0;
  const fuelLiters = +((km * (vehicle?.fuelConsumption ?? 32)) / 100).toFixed(1);
  const fuel = Math.round(fuelLiters * FUEL_PRICE);
  const salary = Math.round(km * (driver?.ratePerKm ?? 10));
  const repair = Math.round(km * REPAIR_PER_KM);
  const tolls = Math.round(km * TOLLS_PER_KM);
  const other = km ? OTHER_PER_TRIP : 0;
  const total = fuel + salary + repair + tolls + other;
  return { fuelLiters, fuel, salary, repair, tolls, other, total, profit: (trip.price || 0) - total };
}

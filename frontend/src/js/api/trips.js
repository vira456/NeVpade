import { request } from './client.js';
import { load } from '../utils/storage.js';
import trips from '../mock/trips.json';
import vehicles from '../mock/vehicles.json';
import drivers from '../mock/drivers.json';

export const getTrips = () => request('/trips', { mock: trips });
export const getTrip = (id) => request(`/trips/${id}`, { mock: trips.find((t) => t.id === id) });
export const createTrip = (data) =>
  request('/trips', { method: 'POST', body: data, mock: { ...data, id: crypto.randomUUID() } });
export const updateTrip = (id, data) =>
  request(`/trips/${id}`, { method: 'PUT', body: data, mock: { ...data, id } });
export const deleteTrip = (id) => request(`/trips/${id}`, { method: 'DELETE', mock: null });

// Розрахунок собівартості рейсу (на сервері — бізнес-логіка Іри).
// У моках рахуємо так само, як описано в контракті, щоб інтерфейс показував правдоподібні цифри.
const FUEL_PRICE = 56; // грн/л
export const calculateTrip = (id) =>
  request(`/trips/${id}/calculate`, {
    method: 'POST',
    mock: () => {
      const trip = trips.find((t) => t.id === id);
      const vehicle = vehicles.find((v) => v.id === trip.vehicleId);
      const driver = drivers.find((d) => d.id === trip.driverId);
      const fuelLiters = +((trip.distanceKm * (vehicle?.fuelConsumption ?? 32)) / 100).toFixed(1);
      const fuelCost = Math.round(fuelLiters * (load('settings')?.fuelPrice ?? FUEL_PRICE));
      const driverSalary = Math.round(trip.distanceKm * (driver?.ratePerKm ?? 10));
      const otherCosts = Math.round(trip.distanceKm * 3.5); // дороги, стоянки, амортизація
      const totalCost = fuelCost + driverSalary + otherCosts;
      return { distanceKm: trip.distanceKm, fuelLiters, fuelCost, driverSalary, otherCosts, totalCost, profit: trip.price - totalCost };
    },
  });

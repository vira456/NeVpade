import { request, ApiError } from './client.js';
import { load, save } from '../utils/storage.js';
import { getCurrentUser } from './auth.js';
import { mockTransferMessage } from './chat.js';
import seedTrips from '../mock/trips.json';
import vehicles from '../mock/vehicles.json';
import drivers from '../mock/drivers.json';

// Рейси всієї компанії (поле managerId — відповідальний менеджер). У моках зберігаються
// в localStorage, щоб передача рейсу колезі не зникала після перезавантаження.
const mockTrips = () => load('mock.trips') ?? seedTrips;
const trips = { find: (fn) => mockTrips().find(fn) };

export const myId = () => getCurrentUser()?.id ?? 'usr_01';

export const getTrips = () => request('/trips', { mock: mockTrips });
export const getTrip = (id) => request(`/trips/${id}`, { mock: () => mockTrips().find((t) => t.id === id) });

// Передати рейс іншому менеджеру компанії. Сервер сам додає повідомлення в чат компанії.
export const transferTrip = (id, toManagerId, comment = '') =>
  request(`/trips/${id}/transfer`, {
    method: 'POST',
    body: { toManagerId, comment },
    mock: () => {
      const all = mockTrips();
      const trip = all.find((t) => t.id === id);
      if (!trip) throw new ApiError('Рейс не знайдено', 404);
      if (trip.managerId !== myId()) throw new ApiError('Передати можна лише свій рейс', 403, 'not_owner');
      trip.managerId = toManagerId;
      trip.transferredAt = new Date().toISOString();
      save('mock.trips', all);
      mockTransferMessage({ tripId: id, toId: toManagerId, text: comment });
      return trip;
    },
  });
// Новий рейс (вручну або імпорт з Della). Номер, менеджера, статус і дату створення ставить сервер.
export const createTrip = (data) =>
  request('/trips', {
    method: 'POST',
    body: data,
    mock: () => {
      const all = mockTrips();
      const last = Math.max(0, ...all.map((t) => Number(String(t.number).replace(/\D/g, '')) || 0));
      const trip = {
        ...data,
        id: `trp_${Date.now().toString(36)}`,
        number: `TR-${String(last + 1).padStart(4, '0')}`,
        status: 'planned',
        managerId: myId(),
        createdAt: new Date().toISOString(),
      };
      save('mock.trips', [...all, trip]);
      return trip;
    },
  });
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

import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { mockTransferMessage } from './chat.js';
import { mockTrips, saveTrips, mockVehicles, mockDrivers } from './mock-store.js';

// Рейси всієї компанії (поле managerId — відповідальний менеджер)

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
      saveTrips(all);
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
      saveTrips([...all, trip]);
      return trip;
    },
  });
// Редагувати й видаляти можна лише свої рейси (сервер теж перевіряє)
function ownTrip(all, id) {
  const trip = all.find((t) => t.id === id);
  if (!trip) throw new ApiError('Рейс не знайдено', 404);
  if (trip.managerId !== myId()) throw new ApiError('Змінювати можна лише свої рейси', 403, 'not_owner');
  return trip;
}

export const updateTrip = (id, data) =>
  request(`/trips/${id}`, {
    method: 'PUT',
    body: data,
    mock: () => {
      const all = mockTrips();
      const trip = Object.assign(ownTrip(all, id), data, { updatedAt: new Date().toISOString() });
      saveTrips(all);
      return trip;
    },
  });

export const deleteTrip = (id) =>
  request(`/trips/${id}`, {
    method: 'DELETE',
    mock: () => {
      const all = mockTrips();
      ownTrip(all, id);
      saveTrips(all.filter((t) => t.id !== id));
      return null;
    },
  });

// Розрахунок собівартості рейсу (на сервері — бізнес-логіка Іри).
// У моках рахуємо так само, як описано в контракті, щоб інтерфейс показував правдоподібні цифри.
const FUEL_PRICE = 56; // грн/л
export const calculateTrip = (id) =>
  request(`/trips/${id}/calculate`, {
    method: 'POST',
    mock: () => {
      const trip = mockTrips().find((t) => t.id === id);
      if (!trip) throw new ApiError('Рейс не знайдено', 404);
      const vehicle = mockVehicles().find((v) => v.id === trip.vehicleId);
      const driver = mockDrivers().find((d) => d.id === trip.driverId);
      const fuelLiters = +((trip.distanceKm * (vehicle?.fuelConsumption ?? 32)) / 100).toFixed(1);
      const fuelCost = Math.round(fuelLiters * FUEL_PRICE);
      const driverSalary = Math.round(trip.distanceKm * (driver?.ratePerKm ?? 10));
      const otherCosts = Math.round(trip.distanceKm * 3.5); // дороги, стоянки, амортизація
      const totalCost = fuelCost + driverSalary + otherCosts;
      return { distanceKm: trip.distanceKm, fuelLiters, fuelCost, driverSalary, otherCosts, totalCost, profit: trip.price - totalCost };
    },
  });

// Водії компанії. Машина закріплюється за водієм полем vehicleId (одна машина — один водій).
import { request, ApiError } from './client.js';
import { deleteOwnerDocsMock } from './documents.js';
import { isOwner } from './trips.js';
import { mockDrivers, saveDrivers, mockTrips, saveTrips, newId } from './mock-store.js';

// У моках: якщо машину віддали цьому водію — у попереднього її знімаємо (так само робить сервер)
const releaseVehicle = (all, vehicleId, exceptId) => {
  if (!vehicleId) return;
  all.forEach((d) => d.id !== exceptId && d.vehicleId === vehicleId && (d.vehicleId = null));
};

export const getDrivers = () => request('/drivers', { mock: mockDrivers });

export const createDriver = (data) =>
  request('/drivers', {
    method: 'POST',
    body: data,
    mock: () => {
      const all = mockDrivers();
      const driver = { status: 'available', vehicleId: null, ...data, id: newId('drv') };
      releaseVehicle(all, driver.vehicleId, driver.id);
      saveDrivers([...all, driver]);
      return driver;
    },
  });

export const updateDriver = (id, data) =>
  request(`/drivers/${id}`, {
    method: 'PUT',
    body: data,
    mock: () => {
      const all = mockDrivers();
      const d = all.find((x) => x.id === id);
      if (!d) throw new ApiError('Водія не знайдено', 404);
      Object.assign(d, data);
      releaseVehicle(all, d.vehicleId, id);
      saveDrivers(all);
      return d;
    },
  });

/** Закріпити машину за водієм (vehicleId = null — відкріпити) */
export const assignVehicle = (driverId, vehicleId) =>
  request(`/drivers/${driverId}/vehicle`, {
    method: 'PUT',
    body: { vehicleId },
    mock: () => {
      const all = mockDrivers();
      const d = all.find((x) => x.id === driverId);
      if (!d) throw new ApiError('Водія не знайдено', 404);
      d.vehicleId = vehicleId;
      releaseVehicle(all, vehicleId, driverId);
      saveDrivers(all);
      return d;
    },
  });

export const deleteDriver = (id) =>
  request(`/drivers/${id}`, {
    method: 'DELETE',
    mock: async () => {
      if (!isOwner()) throw new ApiError('Видаляти водіїв може лише керівник', 403, 'owner_only');
      const trips = mockTrips();
      const active = trips.find((t) => t.driverId === id && t.status === 'in_progress');
      if (active) throw new ApiError(`Водій зараз у рейсі ${active.number}. Спершу завершіть або змініть рейс.`, 409, 'driver_busy');
      trips.forEach((t) => t.driverId === id && t.status === 'planned' && (t.driverId = null));
      saveTrips(trips);
      saveDrivers(mockDrivers().filter((d) => d.id !== id));
      await deleteOwnerDocsMock('drivers', id); // разом із копіями документів
      return null;
    },
  });

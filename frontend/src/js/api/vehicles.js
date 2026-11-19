// Автомобілі компанії
import { request, ApiError } from './client.js';
import { deleteOwnerDocsMock } from './documents.js';
import { mockVehicles, saveVehicles, mockDrivers, saveDrivers, mockTrips, saveTrips, newId } from './mock-store.js';

const samePlate = (a, b) => a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();

function checkPlate(all, plate, exceptId) {
  if (all.some((v) => v.id !== exceptId && samePlate(v.plate, plate))) {
    throw new ApiError('Машина з таким номером уже є в автопарку', 409, 'plate_taken');
  }
}

export const getVehicles = () => request('/vehicles', { mock: mockVehicles });

export const createVehicle = (data) =>
  request('/vehicles', {
    method: 'POST',
    body: data,
    mock: () => {
      const all = mockVehicles();
      checkPlate(all, data.plate);
      const vehicle = { status: 'available', ...data, id: newId('veh'), statusUpdatedAt: new Date().toISOString() };
      saveVehicles([...all, vehicle]);
      return vehicle;
    },
  });

export const updateVehicle = (id, data) =>
  request(`/vehicles/${id}`, {
    method: 'PUT',
    body: data,
    mock: () => {
      const all = mockVehicles();
      const v = all.find((x) => x.id === id);
      if (!v) throw new ApiError('Машину не знайдено', 404);
      checkPlate(all, data.plate ?? v.plate, id);
      if (data.status && data.status !== v.status) data.statusUpdatedAt = new Date().toISOString();
      Object.assign(v, data);
      saveVehicles(all);
      return v;
    },
  });

/** Швидка зміна стану: на завантаженні / в дорозі / розвантажилась / зламалась … */
export const setVehicleStatus = (id, status) =>
  request(`/vehicles/${id}/status`, {
    method: 'PATCH',
    body: { status },
    mock: () => {
      const all = mockVehicles();
      const v = all.find((x) => x.id === id);
      if (!v) throw new ApiError('Машину не знайдено', 404);
      Object.assign(v, { status, statusUpdatedAt: new Date().toISOString() });
      saveVehicles(all);
      return v;
    },
  });

/** Видалення: не можна, поки машина в активному рейсі; із запланованих рейсів її знімає */
export const deleteVehicle = (id) =>
  request(`/vehicles/${id}`, {
    method: 'DELETE',
    mock: async () => {
      const trips = mockTrips();
      const active = trips.find((t) => t.vehicleId === id && t.status === 'in_progress');
      if (active) throw new ApiError(`Машина зараз у рейсі ${active.number}. Спершу завершіть або змініть рейс.`, 409, 'vehicle_busy');
      trips.forEach((t) => t.vehicleId === id && t.status === 'planned' && (t.vehicleId = null));
      saveTrips(trips);
      saveDrivers(mockDrivers().map((d) => (d.vehicleId === id ? { ...d, vehicleId: null } : d)));
      saveVehicles(mockVehicles().filter((v) => v.id !== id));
      await deleteOwnerDocsMock('vehicles', id); // разом із копіями документів
      return null;
    },
  });

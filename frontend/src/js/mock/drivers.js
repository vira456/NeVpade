// Водії в режимі моків
import { ApiError } from '../api/client.js';
import { mockDrivers, saveDrivers, mockTrips, saveTrips, newId } from './store.js';
import { deleteOwnerDocs } from './documents.js';

// Якщо машину віддали цьому водію — у попереднього її знімаємо (так само робить сервер)
const releaseVehicle = (all, vehicleId, exceptId) => {
  if (!vehicleId) return;
  all.forEach((d) => d.id !== exceptId && d.vehicleId === vehicleId && (d.vehicleId = null));
};

function find(all, id) {
  const d = all.find((x) => x.id === id);
  if (!d) throw new ApiError('Водія не знайдено', 404);
  return d;
}

export const list = () => mockDrivers();

export function create(data) {
  const all = mockDrivers();
  const driver = { status: 'available', vehicleId: null, ...data, id: newId('drv') };
  releaseVehicle(all, driver.vehicleId, driver.id);
  saveDrivers([...all, driver]);
  return driver;
}

export function update(id, data) {
  const all = mockDrivers();
  const d = find(all, id);
  Object.assign(d, data);
  releaseVehicle(all, d.vehicleId, id);
  saveDrivers(all);
  return d;
}

export function assignVehicle(driverId, vehicleId) {
  const all = mockDrivers();
  const d = find(all, driverId);
  d.vehicleId = vehicleId;
  releaseVehicle(all, vehicleId, driverId);
  saveDrivers(all);
  return d;
}

export async function remove(id) {
  const trips = mockTrips();
  const active = trips.find((t) => t.driverId === id && t.status === 'in_progress');
  if (active) throw new ApiError(`Водій зараз у рейсі ${active.number}. Спершу завершіть або змініть рейс.`, 409, 'driver_busy');
  trips.forEach((t) => t.driverId === id && t.status === 'planned' && (t.driverId = null));
  saveTrips(trips);
  saveDrivers(mockDrivers().filter((d) => d.id !== id));
  await deleteOwnerDocs('drivers', id); // разом із копіями документів
  return null;
}

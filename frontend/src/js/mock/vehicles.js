// Автопарк у режимі моків
import { ApiError } from '../api/client.js';
import { mockVehicles, saveVehicles, mockDrivers, saveDrivers, mockTrips, saveTrips, newId } from './store.js';
import { deleteOwnerDocs } from './documents.js';

const samePlate = (a, b) => a.replace(/\s/g, '').toUpperCase() === b.replace(/\s/g, '').toUpperCase();

function checkPlate(all, plate, exceptId) {
  if (all.some((v) => v.id !== exceptId && samePlate(v.plate, plate))) {
    throw new ApiError('Машина з таким номером уже є в автопарку', 409, 'plate_taken');
  }
}

function find(all, id) {
  const v = all.find((x) => x.id === id);
  if (!v) throw new ApiError('Машину не знайдено', 404);
  return v;
}

export const list = () => mockVehicles();

export function create(data) {
  const all = mockVehicles();
  checkPlate(all, data.plate);
  const vehicle = { status: 'available', ...data, id: newId('veh'), statusUpdatedAt: new Date().toISOString() };
  saveVehicles([...all, vehicle]);
  return vehicle;
}

export function update(id, data) {
  const all = mockVehicles();
  const v = find(all, id);
  checkPlate(all, data.plate ?? v.plate, id);
  if (data.status && data.status !== v.status) data.statusUpdatedAt = new Date().toISOString();
  Object.assign(v, data);
  saveVehicles(all);
  return v;
}

export function setStatus(id, status) {
  const all = mockVehicles();
  const v = find(all, id);
  Object.assign(v, { status, statusUpdatedAt: new Date().toISOString() });
  saveVehicles(all);
  return v;
}

/** Не можна, поки машина в активному рейсі; із запланованих рейсів її знімає */
export async function remove(id) {
  const trips = mockTrips();
  const active = trips.find((t) => t.vehicleId === id && t.status === 'in_progress');
  if (active) throw new ApiError(`Машина зараз у рейсі ${active.number}. Спершу завершіть або змініть рейс.`, 409, 'vehicle_busy');
  trips.forEach((t) => t.vehicleId === id && t.status === 'planned' && (t.vehicleId = null));
  saveTrips(trips);
  saveDrivers(mockDrivers().map((d) => (d.vehicleId === id ? { ...d, vehicleId: null } : d)));
  saveVehicles(mockVehicles().filter((v) => v.id !== id));
  await deleteOwnerDocs('vehicles', id); // разом із копіями документів
  return null;
}

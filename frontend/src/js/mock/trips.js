// Рейси в режимі моків. На сервері те саме робить бекенд (права, історія змін, стан машини й водія).
import { ApiError } from '../api/client.js';
import { myId, canEditTrip, defaultDueDate } from '../api/trips.js';
import { tripCosts } from '../utils/economics.js';
import { mockTrips, saveTrips, mockVehicles, saveVehicles, mockDrivers, saveDrivers, mockClients } from './store.js';
import { transferMessage } from './chat.js';
import { deleteOwnerDocs } from './documents.js';

const now = () => new Date().toISOString();
const log = (trip, entry) => (trip.history = [...(trip.history ?? []), { at: now(), by: myId(), ...entry }]);

const UNAVAILABLE = { broken: 'зламалась', repair: 'на ремонті' };

function checkVehicle(vehicleId) {
  if (!vehicleId) return;
  const v = mockVehicles().find((x) => x.id === vehicleId);
  if (v && UNAVAILABLE[v.status]) {
    throw new ApiError(`Машина ${v.plate} ${UNAVAILABLE[v.status]} — оберіть іншу`, 409, 'vehicle_unavailable');
  }
}

/** Стан машини й водія йде за статусом рейсу: у дорозі → «В дорозі», завершено → «Вільна» */
function syncFleet(trip, all) {
  const vehicles = mockVehicles();
  const drivers = mockDrivers();
  const busyElsewhere = (key, id) => all.some((t) => t.id !== trip.id && t[key] === id && t.status === 'in_progress');
  const v = vehicles.find((x) => x.id === trip.vehicleId);
  const d = drivers.find((x) => x.id === trip.driverId);
  if (trip.status === 'in_progress') {
    if (v && !['loading', 'on_trip', 'unloaded'].includes(v.status)) Object.assign(v, { status: 'on_trip', statusUpdatedAt: now() });
    if (d) d.status = 'on_trip';
  } else if (['done', 'cancelled'].includes(trip.status)) {
    if (v && ['loading', 'on_trip', 'unloaded'].includes(v.status) && !busyElsewhere('vehicleId', v.id)) {
      Object.assign(v, { status: 'available', statusUpdatedAt: now() });
    }
    if (d && d.status === 'on_trip' && !busyElsewhere('driverId', d.id)) d.status = 'available';
  }
  saveVehicles(vehicles);
  saveDrivers(drivers);
}

function ownTrip(all, id) {
  const trip = all.find((t) => t.id === id);
  if (!trip) throw new ApiError('Рейс не знайдено', 404);
  if (!canEditTrip(trip)) throw new ApiError('Змінювати можна лише свої рейси', 403, 'not_owner');
  return trip;
}

export const list = () => mockTrips();
export const get = (id) => mockTrips().find((t) => t.id === id);

export function transfer(id, toManagerId, comment) {
  const all = mockTrips();
  const trip = ownTrip(all, id);
  log(trip, { action: 'transferred', from: trip.managerId, to: toManagerId });
  trip.managerId = toManagerId;
  trip.transferredAt = now();
  saveTrips(all);
  transferMessage({ tripId: id, toId: toManagerId, text: comment });
  return trip;
}

export function create(data) {
  checkVehicle(data.vehicleId);
  const all = mockTrips();
  const last = Math.max(0, ...all.map((t) => Number(String(t.number).replace(/\D/g, '')) || 0));
  const trip = {
    ...data,
    id: `trp_${Date.now().toString(36)}`,
    number: `TR-${String(last + 1).padStart(4, '0')}`,
    status: 'planned',
    managerId: myId(),
    createdAt: now(),
    history: [],
  };
  trip.payment = { dueDate: data.payment?.dueDate || defaultDueDate(trip, mockClients()), paidAt: data.payment?.paidAt ?? null };
  log(trip, { action: data.source === 'import' ? 'imported' : 'created' });
  saveTrips([...all, trip]);
  return trip;
}

// Які зміни записуємо в історію (назви полів для інтерфейсу — у pages/trips.js)
const TRACKED = ['price', 'loadDate', 'unloadDate', 'driverId', 'vehicleId', 'distanceKm'];

export function update(id, data) {
  const all = mockTrips();
  const trip = ownTrip(all, id);
  if (data.vehicleId && data.vehicleId !== trip.vehicleId) checkVehicle(data.vehicleId);
  const changes = TRACKED.filter((k) => k in data && (data[k] ?? null) !== (trip[k] ?? null)).map((k) => ({
    field: k,
    from: trip[k] ?? null,
    to: data[k] ?? null,
  }));
  if (data.from && data.to && (data.from.city !== trip.from.city || data.to.city !== trip.to.city)) {
    changes.push({ field: 'route', from: `${trip.from.city} → ${trip.to.city}`, to: `${data.from.city} → ${data.to.city}` });
  }
  const statusChanged = data.status && data.status !== trip.status;
  const wasPaid = Boolean(trip.payment?.paidAt);
  Object.assign(trip, data, { updatedAt: now() });
  if (statusChanged) log(trip, { action: 'status', to: data.status });
  if (changes.length) log(trip, { action: 'updated', changes });
  if (!wasPaid && trip.payment?.paidAt) log(trip, { action: 'paid' });
  if (wasPaid && !trip.payment?.paidAt) log(trip, { action: 'unpaid' });
  saveTrips(all);
  if (statusChanged || 'vehicleId' in data) syncFleet(trip, all);
  return trip;
}

export function setPayment(id, payment) {
  const all = mockTrips();
  const trip = ownTrip(all, id);
  const wasPaid = Boolean(trip.payment?.paidAt);
  trip.payment = { ...trip.payment, ...payment };
  if (!wasPaid && trip.payment.paidAt) log(trip, { action: 'paid' });
  if (wasPaid && !trip.payment.paidAt) log(trip, { action: 'unpaid' });
  saveTrips(all);
  return trip;
}

export async function remove(id) {
  const all = mockTrips();
  const trip = ownTrip(all, id);
  await deleteOwnerDocs('trips', id); // разом із ТТН, CMR, фото
  const rest = all.filter((t) => t.id !== id);
  saveTrips(rest);
  if (trip.status === 'in_progress') syncFleet({ ...trip, status: 'cancelled' }, rest);
  return null;
}

export function calculate(id) {
  const trip = mockTrips().find((t) => t.id === id);
  if (!trip) throw new ApiError('Рейс не знайдено', 404);
  const vehicle = mockVehicles().find((v) => v.id === trip.vehicleId);
  const driver = mockDrivers().find((d) => d.id === trip.driverId);
  const c = tripCosts(trip, vehicle, driver);
  return {
    distanceKm: trip.distanceKm,
    fuelLiters: c.fuelLiters,
    fuelCost: c.fuel,
    driverSalary: c.salary,
    otherCosts: c.repair + c.tolls + c.other,
    totalCost: c.total,
    profit: c.profit,
  };
}

// Рейси всієї компанії (поле managerId — відповідальний менеджер).
// Права: менеджер змінює лише свої рейси, керівник компанії (role = owner) — будь-які.
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { mockTransferMessage } from './chat.js';
import { mockTrips, saveTrips, mockVehicles, saveVehicles, mockDrivers, saveDrivers, mockClients } from './mock-store.js';
import { tripCosts } from '../utils/economics.js';
import { deleteOwnerDocsMock } from './documents.js';
import { load } from '../utils/storage.js';
import seedCompany from '../mock/company.json';

export const myId = () => getCurrentUser()?.id ?? 'usr_01';

/** Роль поточного користувача: owner (керівник) або manager */
export function myRole() {
  const user = getCurrentUser();
  if (user?.role) return user.role;
  const roles = load('mock.roles') ?? {};
  return roles[myId()] ?? seedCompany.members.find((m) => m.id === myId())?.role ?? 'manager';
}
export const isOwner = () => myRole() === 'owner';
/** Чи може поточний користувач змінювати рейс */
export const canEditTrip = (trip) => trip.managerId === myId() || isOwner();

const now = () => new Date().toISOString();
const log = (trip, entry) => (trip.history = [...(trip.history ?? []), { at: now(), by: myId(), ...entry }]);

export const getTrips = () => request('/trips', { mock: mockTrips });
export const getTrip = (id) => request(`/trips/${id}`, { mock: () => mockTrips().find((t) => t.id === id) });

// ---------- Допоміжне для моків (на сервері те саме робить бекенд) ----------
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

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Термін оплати за замовчуванням: розвантаження + відстрочка клієнта (14 днів, якщо не вказано) */
export function defaultDueDate(trip, clients = mockClients()) {
  const days = clients.find((c) => c.id === trip.clientId)?.paymentDays ?? 14;
  const base = new Date(`${trip.unloadDate || trip.loadDate}T00:00:00`);
  base.setDate(base.getDate() + days);
  return ymd(base);
}

function ownTrip(all, id) {
  const trip = all.find((t) => t.id === id);
  if (!trip) throw new ApiError('Рейс не знайдено', 404);
  if (!canEditTrip(trip)) throw new ApiError('Змінювати можна лише свої рейси', 403, 'not_owner');
  return trip;
}

// ---------- API ----------
// Передати рейс іншому менеджеру компанії. Сервер сам додає повідомлення в чат компанії.
export const transferTrip = (id, toManagerId, comment = '') =>
  request(`/trips/${id}/transfer`, {
    method: 'POST',
    body: { toManagerId, comment },
    mock: () => {
      const all = mockTrips();
      const trip = ownTrip(all, id);
      log(trip, { action: 'transferred', from: trip.managerId, to: toManagerId });
      trip.managerId = toManagerId;
      trip.transferredAt = now();
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
      trip.payment = { dueDate: data.payment?.dueDate || defaultDueDate(trip), paidAt: data.payment?.paidAt ?? null };
      log(trip, { action: data.source === 'import' ? 'imported' : 'created' });
      saveTrips([...all, trip]);
      return trip;
    },
  });

// Які зміни записуємо в історію (назви полів для інтерфейсу — у trips.js)
const TRACKED = ['price', 'loadDate', 'unloadDate', 'driverId', 'vehicleId', 'distanceKm'];

export const updateTrip = (id, data) =>
  request(`/trips/${id}`, {
    method: 'PUT',
    body: data,
    mock: () => {
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
    },
  });

/** Позначити оплату: { paidAt: 'YYYY-MM-DD' } або { paidAt: null } — зняти позначку */
export const setTripPayment = (id, payment) =>
  request(`/trips/${id}/payment`, {
    method: 'PATCH',
    body: payment,
    mock: () => {
      const all = mockTrips();
      const trip = ownTrip(all, id);
      const wasPaid = Boolean(trip.payment?.paidAt);
      trip.payment = { ...trip.payment, ...payment };
      if (!wasPaid && trip.payment.paidAt) log(trip, { action: 'paid' });
      if (wasPaid && !trip.payment.paidAt) log(trip, { action: 'unpaid' });
      saveTrips(all);
      return trip;
    },
  });

export const deleteTrip = (id) =>
  request(`/trips/${id}`, {
    method: 'DELETE',
    mock: async () => {
      const all = mockTrips();
      const trip = ownTrip(all, id);
      await deleteOwnerDocsMock('trips', id); // разом із ТТН, CMR, фото
      const rest = all.filter((t) => t.id !== id);
      saveTrips(rest);
      if (trip.status === 'in_progress') syncFleet({ ...trip, status: 'cancelled' }, rest);
      return null;
    },
  });

// Розрахунок собівартості рейсу (на сервері — бізнес-логіка Іри; формула — utils/economics.js)
export const calculateTrip = (id) =>
  request(`/trips/${id}/calculate`, {
    method: 'POST',
    mock: () => {
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
    },
  });

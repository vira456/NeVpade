// Рейси всієї компанії (поле managerId — відповідальний менеджер).
// Права: менеджер змінює лише свої рейси, власник компанії (role = owner) — будь-які.
// Відповіді в режимі моків — mock/trips.js.
import { request } from './client.js';
import { getCurrentUser, roleOf } from './auth.js';

export const myId = () => String(getCurrentUser()?.id ?? getCurrentUser()?._id ?? 'usr_01');

/** Роль поточного користувача: owner (власник) або manager */
export const myRole = () => roleOf(getCurrentUser());
export const isOwner = () => myRole() === 'owner';
/** Чи може поточний користувач змінювати рейс */
export const canEditTrip = (trip) => trip.managerId === myId() || isOwner();

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Термін оплати за замовчуванням: розвантаження + відстрочка клієнта (14 днів, якщо не вказано) */
export function defaultDueDate(trip, clients = []) {
  const days = clients.find((c) => c.id === trip.clientId)?.paymentDays ?? 14;
  const base = new Date(`${trip.unloadDate || trip.loadDate}T00:00:00`);
  base.setDate(base.getDate() + days);
  return ymd(base);
}

export const getTrips = () => request('/trips', { mock: (m) => m.trips.list() });
export const getTrip = (id) => request(`/trips/${id}`, { mock: (m) => m.trips.get(id) });

// Передати рейс іншому менеджеру компанії. Сервер сам додає повідомлення в чат компанії.
export const transferTrip = (id, toManagerId, comment = '') =>
  request(`/trips/${id}/transfer`, { method: 'POST', body: { toManagerId, comment }, mock: (m) => m.trips.transfer(id, toManagerId, comment) });

// Новий рейс (вручну або імпорт з Della). Номер, менеджера, статус і дату створення ставить сервер.
export const createTrip = (data) => request('/trips', { method: 'POST', body: data, mock: (m) => m.trips.create(data) });

export const updateTrip = (id, data) => request(`/trips/${id}`, { method: 'PUT', body: data, mock: (m) => m.trips.update(id, data) });

/** Позначити оплату: { paidAt: 'YYYY-MM-DD' } або { paidAt: null } — зняти позначку */
export const setTripPayment = (id, payment) =>
  request(`/trips/${id}/payment`, { method: 'PATCH', body: payment, mock: (m) => m.trips.setPayment(id, payment) });

export const deleteTrip = (id) => request(`/trips/${id}`, { method: 'DELETE', mock: (m) => m.trips.remove(id) });

// Розрахунок собівартості рейсу (на сервері — бізнес-логіка Іри; формула — utils/economics.js)
export const calculateTrip = (id) => request(`/trips/${id}/calculate`, { method: 'POST', mock: (m) => m.trips.calculate(id) });

// Повідомлення замовнику у Viber: готовий текст, номер замовника, посилання на документи водія й машини.
// У режимі моків сервера немає — null, тоді кнопка відкриває Viber з вибором контакту (utils/viber.js).
export const clientMessage = (id) => request(`/trips/${id}/client-message`, { method: 'POST', mock: () => null });

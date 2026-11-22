// Клієнти в режимі моків
import { ApiError } from '../api/client.js';
import { mockClients, saveClients, mockTrips, saveTrips, newId } from './store.js';

const sameEdrpou = (a, b) => a && b && a.replace(/\D/g, '') === b.replace(/\D/g, '');

function checkUnique(all, data, exceptId) {
  if (data.edrpou && all.some((c) => c.id !== exceptId && sameEdrpou(c.edrpou, data.edrpou))) {
    throw new ApiError('Клієнт з таким ЄДРПОУ вже є', 409, 'edrpou_taken');
  }
}

export const list = () => mockClients();

export function create(data) {
  const all = mockClients();
  checkUnique(all, data);
  const client = { paymentDays: 14, notes: '', ...data, id: newId('cli'), createdAt: new Date().toISOString() };
  saveClients([...all, client]);
  return client;
}

export function update(id, data) {
  const all = mockClients();
  const client = all.find((c) => c.id === id);
  if (!client) throw new ApiError('Клієнта не знайдено', 404);
  checkUnique(all, data, id);
  Object.assign(client, data);
  saveClients(all);
  // знімок у рейсах оновлюємо, щоб усюди була нова назва
  saveTrips(mockTrips().map((t) => (t.clientId === id ? { ...t, client: { name: client.name, phone: client.phone } } : t)));
  return client;
}

/** Лише клієнта без рейсів (історію рейсів не губимо) */
export function remove(id) {
  const count = mockTrips().filter((t) => t.clientId === id).length;
  if (count) throw new ApiError(`У клієнта є рейси (${count}) — його не можна видалити`, 409, 'client_has_trips');
  saveClients(mockClients().filter((c) => c.id !== id));
  return null;
}

// Клієнти (замовники перевезень). Рейс посилається на клієнта полем clientId,
// а client { name, phone } у рейсі — знімок для швидкого показу. Відповіді в режимі моків — mock/clients.js.
import { request } from './client.js';

export const getClients = () => request('/clients', { mock: (m) => m.clients.list() });

export const createClient = (data) => request('/clients', { method: 'POST', body: data, mock: (m) => m.clients.create(data) });

export const updateClient = (id, data) => request(`/clients/${id}`, { method: 'PUT', body: data, mock: (m) => m.clients.update(id, data) });

/** Видалити можна лише клієнта без рейсів (історію рейсів не губимо) */
export const deleteClient = (id) => request(`/clients/${id}`, { method: 'DELETE', mock: (m) => m.clients.remove(id) });

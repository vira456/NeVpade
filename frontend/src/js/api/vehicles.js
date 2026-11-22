// Автомобілі компанії. Відповіді в режимі моків — mock/vehicles.js.
import { request } from './client.js';

export const getVehicles = () => request('/vehicles', { mock: (m) => m.vehicles.list() });

export const createVehicle = (data) => request('/vehicles', { method: 'POST', body: data, mock: (m) => m.vehicles.create(data) });

export const updateVehicle = (id, data) => request(`/vehicles/${id}`, { method: 'PUT', body: data, mock: (m) => m.vehicles.update(id, data) });

/** Швидка зміна стану: на завантаженні / в дорозі / розвантажилась / зламалась … */
export const setVehicleStatus = (id, status) =>
  request(`/vehicles/${id}/status`, { method: 'PATCH', body: { status }, mock: (m) => m.vehicles.setStatus(id, status) });

/** Видалення: не можна, поки машина в активному рейсі; із запланованих рейсів її знімає */
export const deleteVehicle = (id) => request(`/vehicles/${id}`, { method: 'DELETE', mock: (m) => m.vehicles.remove(id) });

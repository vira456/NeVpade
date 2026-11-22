// Водії компанії. Машина закріплюється за водієм полем vehicleId (одна машина — один водій).
// Відповіді в режимі моків — mock/drivers.js.
import { request } from './client.js';

export const getDrivers = () => request('/drivers', { mock: (m) => m.drivers.list() });

export const createDriver = (data) => request('/drivers', { method: 'POST', body: data, mock: (m) => m.drivers.create(data) });

export const updateDriver = (id, data) => request(`/drivers/${id}`, { method: 'PUT', body: data, mock: (m) => m.drivers.update(id, data) });

/** Закріпити машину за водієм (vehicleId = null — відкріпити) */
export const assignVehicle = (driverId, vehicleId) =>
  request(`/drivers/${driverId}/vehicle`, { method: 'PUT', body: { vehicleId }, mock: (m) => m.drivers.assignVehicle(driverId, vehicleId) });

export const deleteDriver = (id) => request(`/drivers/${id}`, { method: 'DELETE', mock: (m) => m.drivers.remove(id) });

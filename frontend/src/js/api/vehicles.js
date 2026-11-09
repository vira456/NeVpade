import { request } from './client.js';
import vehicles from '../mock/vehicles.json';

export const getVehicles = () => request('/vehicles', { mock: vehicles });
export const createVehicle = (data) =>
  request('/vehicles', { method: 'POST', body: data, mock: { ...data, id: crypto.randomUUID() } });
export const updateVehicle = (id, data) =>
  request(`/vehicles/${id}`, { method: 'PUT', body: data, mock: { ...data, id } });
export const deleteVehicle = (id) => request(`/vehicles/${id}`, { method: 'DELETE', mock: null });

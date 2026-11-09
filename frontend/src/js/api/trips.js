import { request } from './client.js';
import trips from '../mock/trips.json';

export const getTrips = () => request('/trips', { mock: trips });
export const getTrip = (id) => request(`/trips/${id}`, { mock: trips.find((t) => t.id === id) });
export const createTrip = (data) =>
  request('/trips', { method: 'POST', body: data, mock: { ...data, id: crypto.randomUUID() } });
export const updateTrip = (id, data) =>
  request(`/trips/${id}`, { method: 'PUT', body: data, mock: { ...data, id } });
export const deleteTrip = (id) => request(`/trips/${id}`, { method: 'DELETE', mock: null });

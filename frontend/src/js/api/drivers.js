import { request } from './client.js';
import drivers from '../mock/drivers.json';

export const getDrivers = () => request('/drivers', { mock: drivers });

// Дані режиму моків (VITE_USE_MOCK=true). Зберігаються в localStorage, щоб зміни
// (новий рейс, водій, статус машини…) не зникали після перезавантаження сторінки.
// З реальним бекендом цей файл не використовується.
import { load, save } from '../utils/storage.js';
import seedTrips from '../mock/trips.json';
import seedVehicles from '../mock/vehicles.json';
import seedDrivers from '../mock/drivers.json';

export const mockTrips = () => load('mock.trips') ?? structuredClone(seedTrips);
export const mockVehicles = () => load('mock.vehicles') ?? structuredClone(seedVehicles);
export const mockDrivers = () => load('mock.drivers') ?? structuredClone(seedDrivers);

export const saveTrips = (list) => save('mock.trips', list);
export const saveVehicles = (list) => save('mock.vehicles', list);
export const saveDrivers = (list) => save('mock.drivers', list);

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

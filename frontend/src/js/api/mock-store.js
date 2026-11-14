// Дані режиму моків (VITE_USE_MOCK=true). Зберігаються в localStorage, щоб зміни
// (новий рейс, водій, статус машини…) не зникали після перезавантаження сторінки.
// З реальним бекендом цей файл не використовується.
import { load, save } from '../utils/storage.js';
import seedTrips from '../mock/trips.json';
import seedVehicles from '../mock/vehicles.json';
import seedDrivers from '../mock/drivers.json';
import seedClients from '../mock/clients.json';

const KEYS = ['trips', 'vehicles', 'drivers', 'clients', 'tasks', 'chat'];

// Коли змінюється структура демо-даних — старі збережені дані скидаються до нових
const MOCK_VERSION = 4;
if (load('mock.version') !== MOCK_VERSION) {
  [...KEYS, 'settings', 'anchor'].forEach((k) => localStorage.removeItem(`nevpade.mock.${k}`));
  save('mock.version', MOCK_VERSION);
}

// ---------- Демо-дані «живуть» разом із календарем ----------
// Початкові JSON складено станом на SEED_DATE. Щоб на захисті (через тижні) рейси «в дорозі» не були
// місячної давнини, а аналітика за «цей місяць» не була порожньою, усі дати зсуваються на стільки днів,
// скільки минуло від SEED_DATE. Збережені зміни теж зсуваються, коли настає новий день.
const SEED_DATE = '2026-11-11';
const DAY = 864e5;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00`) - new Date(`${a}T00:00:00`)) / DAY);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:\d{2})?$/;

/** Зсунути всі дати ('YYYY-MM-DD' та ISO з часом) у будь-якій структурі на days днів */
export function shiftDates(value, days) {
  if (!days) return value;
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  }
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) {
      const d = new Date(`${value}T00:00:00`);
      d.setDate(d.getDate() + days);
      return ymd(d);
    }
    if (DATETIME_RE.test(value)) return new Date(new Date(value).getTime() + days * DAY).toISOString();
  }
  return value;
}

const today = ymd(new Date());
// збережені дані: зсуваємо на дні, що минули з останнього відкриття
const anchor = load('mock.anchor') ?? today;
const passed = daysBetween(anchor, today);
if (passed > 0) {
  KEYS.forEach((k) => {
    const stored = load(`mock.${k}`);
    if (stored) save(`mock.${k}`, shiftDates(stored, passed));
  });
}
save('mock.anchor', today);

/** Початкові дані, зсунуті на сьогодні (копія — щоб не змінювати імпортований JSON) */
export const freshSeed = (seed) => shiftDates(structuredClone(seed), Math.max(0, daysBetween(SEED_DATE, today)));

export const mockTrips = () => load('mock.trips') ?? freshSeed(seedTrips);
export const mockVehicles = () => load('mock.vehicles') ?? freshSeed(seedVehicles);
export const mockDrivers = () => load('mock.drivers') ?? freshSeed(seedDrivers);
export const mockClients = () => load('mock.clients') ?? freshSeed(seedClients);

export const saveTrips = (list) => save('mock.trips', list);
export const saveVehicles = (list) => save('mock.vehicles', list);
export const saveDrivers = (list) => save('mock.drivers', list);
export const saveClients = (list) => save('mock.clients', list);

export const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

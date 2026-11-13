// Аналітика. На сервері рахується з рейсів у базі; у режимі моків — так само, з рейсів у браузері,
// тож нові, імпортовані й видалені рейси одразу змінюють цифри.
import { request } from './client.js';
import { mockTrips, mockVehicles, mockDrivers } from './mock-store.js';
import { tripCosts } from '../utils/economics.js';
import { locale } from '../i18n/index.js';

// Які рейси рахуємо в доходах: виконані й ті, що зараз у дорозі (скасовані й заплановані — ні)
const COUNTED = ['done', 'in_progress'];
const DAY = 864e5;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Межі періоду [from, to) і попереднього для порівняння.
 * Порівнюємо однакові відрізки: «1–11 листопада» з «1–11 жовтня», а не з цілим жовтнем.
 */
export function periodRange(period, today = new Date()) {
  const t = startOfDay(today);
  const tomorrow = new Date(t.getTime() + DAY);
  if (period === 'week') {
    const from = new Date(t.getTime() - ((t.getDay() + 6) % 7) * DAY); // понеділок
    return { from, to: new Date(from.getTime() + 7 * DAY), prevFrom: new Date(from.getTime() - 7 * DAY), prevTo: new Date(tomorrow.getTime() - 7 * DAY) };
  }
  if (period === 'year') {
    const y = t.getFullYear();
    return { from: new Date(y, 0, 1), to: new Date(y + 1, 0, 1), prevFrom: new Date(y - 1, 0, 1), prevTo: new Date(y - 1, t.getMonth(), t.getDate() + 1) };
  }
  const y = t.getFullYear();
  const m = t.getMonth();
  const prevLast = new Date(y, m, 0).getDate();
  return { from: new Date(y, m, 1), to: new Date(y, m + 1, 1), prevFrom: new Date(y, m - 1, 1), prevTo: new Date(y, m - 1, Math.min(t.getDate(), prevLast) + 1) };
}

function withCosts(from, to) {
  const vehicles = mockVehicles();
  const drivers = mockDrivers();
  const a = ymd(from);
  const b = ymd(to);
  return mockTrips()
    .filter((t) => COUNTED.includes(t.status) && t.loadDate >= a && t.loadDate < b)
    .map((t) => ({ trip: t, cost: tripCosts(t, vehicles.find((v) => v.id === t.vehicleId), drivers.find((d) => d.id === t.driverId)) }));
}

function totals(rows) {
  const income = rows.reduce((s, r) => s + r.trip.price, 0);
  const expenses = rows.reduce((s, r) => s + r.cost.total, 0);
  return { income, expenses, profit: income - expenses, tripsCount: rows.length, distanceKm: rows.reduce((s, r) => s + r.trip.distanceKm, 0) };
}

export const getSummary = (period = 'month') =>
  request(`/analytics/summary?period=${period}`, {
    mock: () => {
      const r = periodRange(period);
      return { ...totals(withCosts(r.from, r.to)), previous: totals(withCosts(r.prevFrom, r.prevTo)) };
    },
  });

// Графік: тиждень — по днях, місяць — по тижнях (1–7, 8–14…), рік — по місяцях
export const getIncome = (period = 'month') =>
  request(`/analytics/income?period=${period}`, {
    mock: () => {
      const { from, to } = periodRange(period);
      const buckets = [];
      if (period === 'week') {
        for (let i = 0; i < 7; i++) {
          const d = new Date(from.getTime() + i * DAY);
          buckets.push({ from: d, to: new Date(d.getTime() + DAY), label: d.toLocaleDateString(locale(), { weekday: 'short' }) });
        }
      } else if (period === 'year') {
        for (let m = 0; m < 12; m++) {
          const d = new Date(from.getFullYear(), m, 1);
          buckets.push({ from: d, to: new Date(from.getFullYear(), m + 1, 1), label: d.toLocaleDateString(locale(), { month: 'short' }) });
        }
      } else {
        const month = from.toLocaleDateString(locale(), { month: 'short' });
        const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
        for (let day = 1; day <= lastDay; day += 7) {
          const end = Math.min(day + 6, lastDay);
          buckets.push({
            from: new Date(from.getFullYear(), from.getMonth(), day),
            to: new Date(from.getFullYear(), from.getMonth(), end + 1),
            label: `${day}–${end} ${month}`,
          });
        }
      }
      // майбутні відрізки — порожні (null), щоб лінія графіка не «падала» в нуль
      const today = new Date();
      const rows = buckets.map((b) => (b.from > today ? null : totals(withCosts(b.from, b.to))));
      return { labels: buckets.map((b) => b.label), income: rows.map((r) => r?.income ?? null), expenses: rows.map((r) => r?.expenses ?? null) };
    },
  });

export const getExpenses = (period = 'month') =>
  request(`/analytics/expenses?period=${period}`, {
    mock: () => {
      const { from, to } = periodRange(period);
      const out = { fuel: 0, salary: 0, repair: 0, tolls: 0, other: 0 };
      for (const { cost } of withCosts(from, to)) for (const k of Object.keys(out)) out[k] += cost[k];
      return out;
    },
  });

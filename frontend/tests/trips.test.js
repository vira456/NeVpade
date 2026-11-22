// Рейси: термін оплати за замовчуванням, права на зміну, показники менеджера
import { describe, it, expect } from 'vitest';
import { defaultDueDate, canEditTrip } from '../src/js/api/trips.js';
import { kpiFromTrips } from '../src/js/api/profile.js';
import { signIn } from './setup.js';

describe('defaultDueDate', () => {
  const clients = [{ id: 'cli_1', paymentDays: 30 }];

  it('розвантаження + відстрочка клієнта', () => {
    expect(defaultDueDate({ clientId: 'cli_1', loadDate: '2026-11-01', unloadDate: '2026-11-03' }, clients)).toBe('2026-12-03');
  });

  it('без відстрочки — 14 днів; без дати розвантаження — від завантаження', () => {
    expect(defaultDueDate({ clientId: 'cli_x', loadDate: '2026-11-20' }, clients)).toBe('2026-12-04');
  });
});

describe('canEditTrip', () => {
  it('менеджер змінює лише свої рейси', () => {
    signIn({ id: 'usr_01', role: 'manager' });
    expect(canEditTrip({ managerId: 'usr_01' })).toBe(true);
    expect(canEditTrip({ managerId: 'usr_02' })).toBe(false);
  });

  it('власник змінює будь-які', () => {
    signIn({ id: 'usr_00', role: 'owner' });
    expect(canEditTrip({ managerId: 'usr_02' })).toBe(true);
  });
});

describe('kpiFromTrips', () => {
  const month = new Date().toISOString().slice(0, 7);
  const trips = [
    { managerId: 'm1', status: 'done', loadDate: `${month}-01`, price: 10000, driverId: 'd1', payment: { dueDate: '2026-01-10', paidAt: '2026-01-09' } },
    { managerId: 'm1', status: 'done', loadDate: '2025-01-05', price: 8000, payment: { dueDate: '2025-01-20', paidAt: '2025-02-01' } },
    { managerId: 'm1', status: 'in_progress', loadDate: `${month}-02`, price: 5000, driverId: 'd2' },
    { managerId: 'm1', status: 'planned', loadDate: `${month}-28`, price: 7000, driverId: 'd2' },
    { managerId: 'm2', status: 'done', loadDate: `${month}-03`, price: 99999 },
  ];

  it('рахує лише рейси цього менеджера', () => {
    const k = kpiFromTrips(trips, 'm1');
    expect(k.tripsCount).toBe(2); // виконані
    expect(k.tripsThisMonth).toBe(1);
    expect(k.paidOnTime).toBe(50); // 1 з 2 оплачено вчасно
    expect(k.activeTrips).toBe(2);
    expect(k.activeDrivers).toBe(1); // d2 в обох активних
    expect(k.revenueThisMonth).toBe(15000); // виконаний + у дорозі
  });

  it('без оплат — показника «вчасно» немає', () => {
    expect(kpiFromTrips([], 'm1').paidOnTime).toBeNull();
  });
});

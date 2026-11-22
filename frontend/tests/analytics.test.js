// Межі періодів аналітики: порівнюємо однакові відрізки («1–11 листопада» з «1–11 жовтня»)
import { describe, it, expect } from 'vitest';
import { periodRange } from '../src/js/api/analytics.js';

const d = (y, m, day) => new Date(y, m - 1, day);
const same = (a, b) => expect(a.getTime()).toBe(b.getTime());

describe('periodRange', () => {
  it('місяць: з 1-го числа, попередній — той самий відрізок минулого місяця', () => {
    const r = periodRange('month', d(2026, 11, 11));
    same(r.from, d(2026, 11, 1));
    same(r.to, d(2026, 12, 1));
    same(r.prevFrom, d(2026, 10, 1));
    same(r.prevTo, d(2026, 10, 12)); // до 11 жовтня включно
  });

  it('31 березня порівнюється з кінцем лютого, а не виходить за його межі', () => {
    const r = periodRange('month', d(2026, 3, 31));
    same(r.prevFrom, d(2026, 2, 1));
    same(r.prevTo, d(2026, 3, 1)); // 28 лютого включно
  });

  it('тиждень починається з понеділка', () => {
    const r = periodRange('week', d(2026, 11, 12)); // четвер
    same(r.from, d(2026, 11, 9));
    same(r.to, d(2026, 11, 16));
    same(r.prevFrom, d(2026, 11, 2));
  });

  it('рік: з 1 січня, попередній — той самий відрізок минулого року', () => {
    const r = periodRange('year', d(2026, 11, 11));
    same(r.from, d(2026, 1, 1));
    same(r.to, d(2027, 1, 1));
    same(r.prevFrom, d(2025, 1, 1));
    same(r.prevTo, d(2025, 11, 12));
  });
});

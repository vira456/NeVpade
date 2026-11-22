// Форматування для інтерфейсу: множина, захист від XSS, статус оплати
import { describe, it, expect } from 'vitest';
import { plural, escapeHtml, paymentStatus, compactMoney } from '../src/js/utils/format.js';

const FORMS = ['рейс', 'рейси', 'рейсів'];
const iso = (daysFromToday) => new Date(Date.now() + daysFromToday * 864e5).toISOString().slice(0, 10);

describe('plural — українська множина', () => {
  it.each([
    [1, 'рейс'],
    [21, 'рейс'],
    [2, 'рейси'],
    [4, 'рейси'],
    [22, 'рейси'],
    [5, 'рейсів'],
    [11, 'рейсів'],
    [12, 'рейсів'],
    [14, 'рейсів'],
    [0, 'рейсів'],
    [111, 'рейсів'],
  ])('%i → %s', (n, word) => {
    expect(plural(n, FORMS)).toBe(word);
  });
});

describe('escapeHtml', () => {
  it('знешкоджує теги й лапки', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(escapeHtml("O'Brien & Co")).toBe('O&#39;Brien &amp; Co');
  });

  it('порожнє значення — порожній рядок', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });
});

describe('paymentStatus', () => {
  it('оплачений рейс — paid, навіть якщо термін минув', () => {
    expect(paymentStatus({ status: 'done', payment: { dueDate: iso(-10), paidAt: iso(-1) } })).toBe('paid');
  });

  it('термін минув, оплати немає — overdue', () => {
    expect(paymentStatus({ status: 'done', payment: { dueDate: iso(-1), paidAt: null } })).toBe('overdue');
  });

  it('термін ще не настав — pending', () => {
    expect(paymentStatus({ status: 'in_progress', payment: { dueDate: iso(5), paidAt: null } })).toBe('pending');
  });

  it('скасований рейс і рейс без терміну — без статусу', () => {
    expect(paymentStatus({ status: 'cancelled', payment: { dueDate: iso(-5) } })).toBeNull();
    expect(paymentStatus({ status: 'planned' })).toBeNull();
  });
});

describe('compactMoney', () => {
  it('скорочує тисячі й мільйони', () => {
    expect(compactMoney(412000)).toBe('412 тис.');
    expect(compactMoney(4190000)).toMatch(/^4,19\s?млн$/);
    expect(compactMoney(950)).toBe('950');
  });
});

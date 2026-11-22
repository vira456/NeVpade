// Перевірка полів форм: ім'я, пошта, пароль, телефон
import { describe, it, expect } from 'vitest';
import { fullNameError, capitalizeName, isEmail, passwordProblems, phoneDigits, formatPhoneInput, toE164, phoneError, maskPhone } from '../src/js/utils/validation.js';

describe("ім'я та прізвище", () => {
  it('приймає звичайні імена, апостроф і дефіс', () => {
    expect(fullNameError('Олена Коваль')).toBe('');
    expect(fullNameError("Мар'яна Петренко-Сидоренко")).toBe('');
    expect(fullNameError('Anna Smith')).toBe('');
  });

  it('відхиляє одне слово, цифри й зайві слова', () => {
    expect(fullNameError('Олена')).not.toBe('');
    expect(fullNameError('Олена 123')).not.toBe('');
    expect(fullNameError('Коваль Олена Петрівна')).not.toBe(''); // на реєстрації лише два слова
    expect(fullNameError('Коваль Олена Петрівна', { maxWords: 3 })).toBe(''); // у профілі — з по батькові
  });

  it('робить великі літери на початку слів', () => {
    expect(capitalizeName('  олена   петренко-сидоренко ')).toBe('Олена Петренко-Сидоренко');
  });
});

describe('email', () => {
  it.each(['v.fedorova@nevpade.ua', 'olena.koval@gmail.com'])('%s — коректний', (v) => expect(isEmail(v)).toBe(true));
  it.each(['vira@', 'vira@nevpade', 'vira nevpade.ua', '@gmail.com'])('%s — некоректний', (v) => expect(isEmail(v)).toBe(false));
});

describe('пароль', () => {
  it('надійний пароль не має зауважень', () => {
    expect(passwordProblems('Manager2026')).toEqual([]);
  });

  it('перелічує всі невиконані вимоги', () => {
    expect(passwordProblems('abc')).toEqual(['щонайменше 8 символів', 'хоча б одна цифра']);
    expect(passwordProblems('12345678')).toEqual(['хоча б одна літера']);
  });
});

describe('телефон', () => {
  it.each(['+38 (067) 123-45-67', '0671234567', '671234567', '+380671234567'])('%s → 671234567', (v) => {
    expect(phoneDigits(v)).toBe('671234567');
  });

  it('форматує номер для поля й для сервера', () => {
    expect(formatPhoneInput('671234567')).toBe('67 123 45 67');
    expect(toE164('671234567')).toBe('+380671234567');
    expect(maskPhone('+380671234567')).toBe('+380 67 *** ** 67');
  });

  it('перевіряє довжину й код оператора', () => {
    expect(phoneError('671234567')).toBe('');
    expect(phoneError('')).not.toBe('');
    expect(phoneError('67123')).not.toBe('');
    expect(phoneError('441234567')).toMatch(/код оператора/);
  });
});

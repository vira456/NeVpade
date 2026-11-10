import { locale, isEnglish } from '../i18n/index.js';

const UAH = isEnglish ? 'UAH' : 'грн';
const KM = isEnglish ? 'km' : 'км';
export const money = (n) => `${Number(n).toLocaleString(locale())} ${UAH}`;
export const km = (n) => `${Number(n).toLocaleString(locale())} ${KM}`;
export const date = (iso) => new Date(iso).toLocaleDateString(locale());

export const TRIP_STATUS = {
  planned: 'Заплановано',
  in_progress: 'В дорозі',
  done: 'Виконано',
  cancelled: 'Скасовано',
};

export const VEHICLE_STATUS = {
  available: 'Вільний',
  on_trip: 'В рейсі',
  repair: 'Ремонт',
};

export const DRIVER_STATUS = {
  available: 'Вільний',
  on_trip: 'В рейсі',
  day_off: 'Вихідний',
};

// 412000 → «412 тис.», 4194000 → «4,19 млн»
export function compactMoney(n) {
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString(locale(), { maximumFractionDigits: 2 })} ${isEnglish ? 'M' : 'млн'}`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3).toLocaleString(locale())} ${isEnglish ? 'K' : 'тис.'}`;
  return String(n);
}

// Захист від XSS при вставці тексту користувача в innerHTML
export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

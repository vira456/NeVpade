export const money = (n) => `${Number(n).toLocaleString('uk-UA')} грн`;
export const km = (n) => `${Number(n).toLocaleString('uk-UA')} км`;
export const date = (iso) => new Date(iso).toLocaleDateString('uk-UA');

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
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString('uk-UA', { maximumFractionDigits: 2 })} млн`;
  if (Math.abs(n) >= 1e3) return `${Math.round(n / 1e3).toLocaleString('uk-UA')} тис.`;
  return String(n);
}

// Захист від XSS при вставці тексту користувача в innerHTML
export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

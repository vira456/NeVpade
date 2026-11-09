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

// Захист від XSS при вставці тексту користувача в innerHTML
export const escapeHtml = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

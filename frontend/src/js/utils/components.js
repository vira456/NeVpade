// Повторювані елементи інтерфейсу, які малюються з JS
import { locale } from '../i18n/index.js';
import { escapeHtml, TRIP_STATUS } from './format.js';

// Лінія маршруту: «Київ ●┄┄ 475 км ┄┄● Одеса»
export const routeLine = (trip, { size = '' } = {}) => `
  <div class="route ${size ? `route--${size}` : ''}" aria-label="${escapeHtml(trip.from.city)} — ${escapeHtml(trip.to.city)}${trip.distanceKm ? `, ${trip.distanceKm} км` : ''}">
    <span class="route__city">${escapeHtml(trip.from.city)}</span>
    <span class="route__line" aria-hidden="true">${trip.distanceKm ? `<span class="route__km">${trip.distanceKm} км</span>` : ''}</span>
    <span class="route__city">${escapeHtml(trip.to.city)}</span>
  </div>`;

// Український номерний знак
export const plate = (number, { small = false } = {}) => `
  <span class="plate ${small ? 'plate--sm' : ''}" aria-label="Номер ${escapeHtml(number)}">
    <span class="plate__country" aria-hidden="true">UA</span>
    <span class="plate__number">${escapeHtml(number)}</span>
  </span>`;

export const statusBadge = (status, labels = TRIP_STATUS) =>
  `<span class="badge badge--${status}">${labels[status] ?? status}</span>`;

// «12 лист.» / «12.11.2026»
export const shortDate = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) : '—');

// «18 т · 60 м³» (об'єм може бути не вказаний — напр. у вантажу з Della)
const n = (v) => Number(v).toLocaleString(locale()); // 0,16 т — з десятковою комою
export const cargoSize = (cargo) => [`${n(cargo.weightT)} т`, cargo.volumeM3 ? `${n(cargo.volumeM3)} м³` : ''].filter(Boolean).join(' · ');

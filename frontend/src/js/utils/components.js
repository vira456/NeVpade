// Повторювані елементи інтерфейсу, які малюються з JS
import { locale } from '../i18n/index.js';
import { escapeHtml, TRIP_STATUS } from './format.js';

// Лінія маршруту: «Київ ●┄┄ 475 км ┄┄● Одеса»
export const routeLine = (trip, { size = '' } = {}) => `
  <div class="route ${size ? `route--${size}` : ''}" aria-label="${escapeHtml(trip.from.city)} — ${escapeHtml(trip.to.city)}, ${trip.distanceKm} км">
    <span class="route__city">${escapeHtml(trip.from.city)}</span>
    <span class="route__line" aria-hidden="true"><span class="route__km">${trip.distanceKm} км</span></span>
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
export const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

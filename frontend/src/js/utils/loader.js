// Фура-завантажувач з'являється ЛИШЕ коли сайт «гальмує»: запит до API
// триває довше за поріг. Звичайні переходи між сторінками проходять без неї.
import { truckLoader, miniTruck } from './truck.js';

let pending = 0;
let overlay = null;
let chip = null;
let showTimer = null;
let chipTimer = null;
const startedAt = performance.now();
const INITIAL_WINDOW = 2500; // мс: запити в цей час вважаємо «першим завантаженням»
const SLOW_PAGE = 1500; // мс: довше — показуємо фуру на весь екран
const SLOW_ACTION = 2000; // мс: довше — показуємо маленьку фуру в кутку

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'page-loader';
  overlay.innerHTML = truckLoader();
  document.body.appendChild(overlay);
  return overlay;
}

function ensureChip() {
  if (chip) return chip;
  chip = document.createElement('div');
  chip.className = 'loading-chip';
  chip.setAttribute('role', 'status');
  chip.innerHTML = `${miniTruck}<span>Завантаження…</span>`;
  document.body.appendChild(chip);
  return chip;
}

function onStart() {
  pending += 1;
  if (pending !== 1) return;
  if (performance.now() - startedAt < INITIAL_WINDOW && !overlay?.dataset.done) {
    clearTimeout(showTimer);
    showTimer = setTimeout(() => pending && ensureOverlay().classList.add('is-visible'), SLOW_PAGE);
  } else {
    // пізніші довгі запити — маленька фура в кутку
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => pending && ensureChip().classList.add('is-visible'), SLOW_ACTION);
  }
}

function onEnd() {
  pending = Math.max(0, pending - 1);
  if (pending) return;
  clearTimeout(showTimer);
  clearTimeout(chipTimer);
  chip?.classList.remove('is-visible');
  if (overlay) {
    overlay.dataset.done = '1';
    overlay.classList.remove('is-visible');
    overlay.classList.add('is-leaving'); // фура «виїжджає» праворуч
    setTimeout(() => overlay?.remove(), 600);
  }
}

window.addEventListener('api:start', onStart);
window.addEventListener('api:end', onEnd);

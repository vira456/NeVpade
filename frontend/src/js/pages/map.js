import { locale } from '../i18n/index.js';
import { renderLayout } from '../utils/layout.js';
import { getTrips } from '../api/trips.js';
import { getDrivers } from '../api/drivers.js';
import { getVehicles } from '../api/vehicles.js';
import { TRIP_STATUS, money, escapeHtml } from '../utils/format.js';
import { buildTripMessage, sendToViber, copyText } from '../utils/viber.js';
import { flyAway } from '../utils/motion.js';
import { showToast } from '../utils/toast.js';
import { hasApiKey, loadGoogleMaps, onAuthFailure, directionsUrl, embedUrl, formatDuration, estimateDuration, place } from '../utils/maps.js';
import { debounce } from '../utils/debounce.js';

renderLayout();

const els = {
  list: document.getElementById('tripList'),
  search: document.getElementById('mapSearch'),
  status: document.getElementById('mapStatus'),
  map: document.getElementById('map'),
  details: document.getElementById('routeDetails'),
  mode: document.getElementById('mapMode'),
};

let trips = [];
let drivers = [];
let vehicles = [];
let selectedId = null;

// Google Maps JS API (якщо є ключ)
let gmaps = null;
let map = null;
let renderer = null;
let directions = null;

const driverOf = (t) => drivers.find((d) => d.id === t.driverId);
const vehicleOf = (t) => vehicles.find((v) => v.id === t.vehicleId);

// ---------- Список рейсів ----------
function filtered() {
  const q = els.search.value.trim().toLowerCase();
  const status = els.status.value;
  return trips.filter(
    (t) =>
      (!status || t.status === status) &&
      `${t.number} ${t.from.city} ${t.to.city} ${t.cargo.type}`.toLowerCase().includes(q)
  );
}

function renderList() {
  const list = filtered();
  els.list.innerHTML = list.length
    ? list
        .map(
          (t) => `
      <li>
        <button class="trip-item ${t.id === selectedId ? 'is-active' : ''}" type="button" data-id="${t.id}" aria-pressed="${t.id === selectedId}">
          <span class="trip-item__top">
            <strong>${escapeHtml(t.number)}</strong>
            <span class="badge badge--${t.status}">${TRIP_STATUS[t.status]}</span>
          </span>
          <span class="trip-item__route">${escapeHtml(t.from.city)} → ${escapeHtml(t.to.city)}</span>
          <span class="trip-item__meta">${new Date(t.loadDate).toLocaleDateString(locale())} · ${t.distanceKm} км · ${escapeHtml(t.cargo.type)}</span>
        </button>
      </li>`
        )
        .join('')
    : '<li class="trip-list__empty">Рейсів не знайдено</li>';
}

// ---------- Деталі маршруту ----------
function renderDetails(trip, route) {
  const driver = driverOf(trip);
  const vehicle = vehicleOf(trip);
  const km = route ? (route.distance / 1000).toFixed(0) : trip.distanceKm;
  const time = route ? formatDuration(route.duration) : `≈ ${estimateDuration(trip.distanceKm)}`;

  els.details.innerHTML = `
    <div class="route-card__head">
      <h2 class="route-card__title">${escapeHtml(trip.number)}</h2>
      <span class="badge badge--${trip.status}">${TRIP_STATUS[trip.status]}</span>
    </div>
    <ol class="route-card__points">
      <li><span class="route-card__dot route-card__dot--a">A</span>
        <span><strong>${escapeHtml(trip.from.city)}</strong><br><small>${escapeHtml(trip.from.address ?? '')}</small></span></li>
      <li><span class="route-card__dot route-card__dot--b">B</span>
        <span><strong>${escapeHtml(trip.to.city)}</strong><br><small>${escapeHtml(trip.to.address ?? '')}</small></span></li>
    </ol>
    <dl class="route-card__stats">
      <div><dt>Відстань</dt><dd>${km} км</dd></div>
      <div><dt>У дорозі</dt><dd>${time}</dd></div>
      <div><dt>Вартість</dt><dd>${money(trip.price)}</dd></div>
    </dl>
    <dl class="route-card__info">
      <div><dt>Вантаж</dt><dd>${escapeHtml(trip.cargo.type)}, ${trip.cargo.weightT} т</dd></div>
      <div><dt>Водій</dt><dd>${driver ? escapeHtml(driver.name) : '—'}</dd></div>
      <div><dt>Авто</dt><dd>${vehicle ? `${escapeHtml(vehicle.plate)} · ${escapeHtml(vehicle.model)}` : '—'}</dd></div>
    </dl>
    ${route ? '' : '<p class="route-card__note">Час у дорозі орієнтовний (≈ 65 км/год). Точний розрахунок — з ключем Google Maps API.</p>'}
    <div class="route-card__actions">
      <a class="btn" href="${directionsUrl(trip.from, trip.to)}" target="_blank" rel="noopener">Відкрити в Google Maps</a>
      <button class="btn btn--ghost" type="button" data-action="viber">Надіслати водію у Viber</button>
      <button class="btn btn--text" type="button" data-action="copy">Скопіювати посилання</button>
    </div>
  `;
}

// ---------- Карта ----------
function showEmbed(trip) {
  let frame = els.map.querySelector('iframe');
  if (!frame) {
    els.map.innerHTML = '';
    frame = document.createElement('iframe');
    frame.className = 'map-frame';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.allowFullscreen = true;
    els.map.appendChild(frame);
  }
  frame.title = `Маршрут ${trip.from.city} — ${trip.to.city}`;
  frame.src = embedUrl(trip.from, trip.to);
  renderDetails(trip);
}

function showApiRoute(trip) {
  renderDetails(trip); // поки рахується маршрут — дані з рейсу
  directions.route(
    {
      origin: place(trip.from),
      destination: place(trip.to),
      travelMode: gmaps.TravelMode.DRIVING,
    },
    (result, status) => {
      if (status !== 'OK' || trip.id !== selectedId) return;
      renderer.setDirections(result);
      const leg = result.routes[0].legs[0];
      renderDetails(trip, { distance: leg.distance.value, duration: leg.duration.value });
    }
  );
}

function select(id) {
  const trip = trips.find((t) => t.id === id);
  if (!trip) return;
  selectedId = id;
  history.replaceState(null, '', `?trip=${id}`);
  renderList();
  if (map) showApiRoute(trip);
  else showEmbed(trip);
}

// Перехід на вбудовану карту, якщо API недоступний
function fallbackToEmbed(err) {
  map = null;
  els.mode.textContent = 'Google Maps (вбудована карта)';
  if (err) showToast(`${err.message}. Показано вбудовану карту`, 'error', 6000);
  els.map.innerHTML = '';
  const trip = trips.find((t) => t.id === selectedId);
  if (trip) showEmbed(trip);
}

async function initMap() {
  if (!hasApiKey) {
    els.mode.textContent = 'Google Maps (вбудована карта)';
    return;
  }
  onAuthFailure(fallbackToEmbed);
  try {
    gmaps = await loadGoogleMaps();
    els.map.innerHTML = '';
    map = new gmaps.Map(els.map, { center: { lat: 49, lng: 31 }, zoom: 6, mapTypeControl: false, streetViewControl: false });
    renderer = new gmaps.DirectionsRenderer({ map });
    directions = new gmaps.DirectionsService();
    els.mode.textContent = 'Google Maps JavaScript API';
  } catch (err) {
    // Недійсний ключ чи немає інтернету — не лишаємо порожній екран
    if (map === null && !els.map.querySelector('iframe')) fallbackToEmbed(err);
  }
}

// ---------- Події ----------
els.list.addEventListener('click', (e) => {
  const item = e.target.closest('.trip-item');
  if (item) select(item.dataset.id);
});

els.search.addEventListener('input', debounce(renderList));
els.status.addEventListener('change', renderList);

els.details.addEventListener('click', async (e) => {
  const action = e.target.closest('[data-action]')?.dataset.action;
  const trip = trips.find((t) => t.id === selectedId);
  if (!action || !trip) return;
  const link = directionsUrl(trip.from, trip.to);

  if (action === 'copy') {
    try {
      await copyText(link);
      showToast('Посилання на маршрут скопійовано');
    } catch {
      showToast('Не вдалося скопіювати', 'error');
    }
  }
  if (action === 'viber') {
    flyAway(e.target.closest('[data-action]'));
    sendToViber(`${buildTripMessage(trip, driverOf(trip), vehicleOf(trip))}\n🗺 Маршрут: ${link}`);
  }
});

// ---------- Старт ----------
async function init() {
  // скрипт Google Maps і дані рейсів вантажимо одночасно
  [[trips, drivers, vehicles]] = await Promise.all([Promise.all([getTrips(), getDrivers(), getVehicles()]), initMap()]);

  const fromUrl = new URLSearchParams(location.search).get('trip');
  const first = trips.find((t) => t.id === fromUrl) ?? trips.find((t) => t.status !== 'done') ?? trips[0];
  if (first) select(first.id);
  else renderList();
}

init();

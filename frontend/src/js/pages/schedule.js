// Графік машин: які машини зайняті рейсами по днях тижня, хто вільний на потрібну дату
import { renderLayout } from '../utils/layout.js';
import { getTrips } from '../api/trips.js';
import { getVehicles } from '../api/vehicles.js';
import { getDrivers } from '../api/drivers.js';
import { escapeHtml, VEHICLE_STATUS, TRIP_STATUS } from '../utils/format.js';
import { plate, statusBadge } from '../utils/components.js';
import { t, locale } from '../i18n/index.js';

renderLayout();

const DAYS = 7;
const DAY = 864e5;
const $ = (id) => document.getElementById(id);
const grid = $('schedule');

let trips = [];
let vehicles = [];
let drivers = [];
let start = monday(new Date());
let selected = ymd(new Date());

function monday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const UNAVAILABLE = ['broken', 'repair'];

// Рейс займає машину з дня завантаження по день розвантаження (включно)
const tripEnd = (tr) => tr.unloadDate || tr.loadDate;
const busyOn = (vehicleId, day) =>
  trips.find((tr) => tr.vehicleId === vehicleId && tr.status !== 'cancelled' && tr.loadDate <= day && tripEnd(tr) >= day);

function freeVehicles(day) {
  return vehicles.filter((v) => !UNAVAILABLE.includes(v.status) && !busyOn(v.id, day));
}

function render() {
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
  const first = ymd(days[0]);
  const last = ymd(days[DAYS - 1]);
  const today = ymd(new Date());
  const fmt = (d, opts) => d.toLocaleDateString(locale(), opts);
  const end = days[DAYS - 1];
  // «9–15 листопада 2026», а якщо тиждень на межі місяців — «28 жовтня – 3 листопада 2026»
  const sameMonth = days[0].getMonth() === end.getMonth();
  const endText = fmt(end, { day: 'numeric', month: 'long', year: 'numeric' });
  $('scheduleRange').textContent = sameMonth ? `${days[0].getDate()}–${endText}` : `${fmt(days[0], { day: 'numeric', month: 'long' })} – ${endText}`;

  const head = `
    <div class="schedule__row schedule__row--head" role="row">
      <div class="schedule__vehicle" role="columnheader">Машина</div>
      ${days
        .map((d) => {
          const key = ymd(d);
          const weekend = d.getDay() === 0 || d.getDay() === 6;
          return `<button class="schedule__day${key === today ? ' is-today' : ''}${weekend ? ' is-weekend' : ''}${key === selected ? ' is-selected' : ''}" type="button" role="columnheader" data-day="${key}"
            aria-pressed="${key === selected}" aria-label="${escapeHtml(t('Вільні машини на {date}', { date: fmt(d, { day: 'numeric', month: 'long' }) }))}">
            <span>${fmt(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong></button>`;
        })
        .join('')}
    </div>`;

  // рейси без машини в цьому проміжку — окремим рядком, щоб не загубились
  const unassigned = trips.filter((tr) => !tr.vehicleId && tr.status !== 'cancelled' && tr.loadDate <= last && tripEnd(tr) >= first);

  const rows = vehicles.map((v) => {
    const driver = drivers.find((d) => d.vehicleId === v.id);
    const off = UNAVAILABLE.includes(v.status);
    const bars = trips.filter((tr) => tr.vehicleId === v.id && tr.status !== 'cancelled' && tr.loadDate <= last && tripEnd(tr) >= first);
    return rowHtml({
      label: `${plate(v.plate, { small: true })}<span class="schedule__model" data-no-i18n>${escapeHtml(v.model)}</span>
        <span class="schedule__driver" data-no-i18n>${escapeHtml(driver?.name ?? t('без водія'))}</span>
        ${off ? statusBadge(v.status, VEHICLE_STATUS) : ''}`,
      bars,
      days,
      off,
      today,
    });
  });
  if (unassigned.length) rows.push(rowHtml({ label: `<strong>${t('Без машини')}</strong><span class="schedule__model">${t('потрібно призначити')}</span>`, bars: unassigned, days, today, warn: true }));

  grid.style.setProperty('--days', DAYS);
  grid.innerHTML = head + rows.join('');
  renderFree();
}

function rowHtml({ label, bars, days, off = false, today, warn = false }) {
  const first = ymd(days[0]);
  const last = ymd(days[days.length - 1]);
  const col = (iso) => Math.round((new Date(`${iso}T00:00:00`) - days[0]) / DAY); // 0..6
  // Рейси, що перетинаються в часі, кладемо на окремі «доріжки» одна під одною, а не поверх
  const lanes = [];
  const placed = [...bars]
    .sort((a, b) => a.loadDate.localeCompare(b.loadDate))
    .map((tr) => {
      const from = Math.max(0, col(tr.loadDate));
      const to = Math.min(DAYS - 1, col(tripEnd(tr)));
      let lane = lanes.findIndex((end) => end < from);
      if (lane === -1) lane = lanes.push(-1) - 1;
      lanes[lane] = to;
      return { tr, from, to, lane };
    });
  const laneCount = Math.max(1, lanes.length);
  return `
    <div class="schedule__row${off ? ' is-off' : ''}${warn ? ' is-warn' : ''}" role="row" style="--lanes: ${laneCount}">
      <div class="schedule__vehicle" role="rowheader">${label}</div>
      ${days
        .map(
          (d, i) =>
            `<div class="schedule__cell${ymd(d) === today ? ' is-today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' is-weekend' : ''}" style="grid-column: ${i + 2}" role="gridcell"></div>`
        )
        .join('')}
      ${placed
        .map(({ tr, from, to, lane }) => {
          const cut = (tr.loadDate < first ? ' is-cut-start' : '') + (tripEnd(tr) > last ? ' is-cut-end' : '');
          return `<a class="schedule-bar schedule-bar--${tr.status}${cut}" href="/pages/trips.html?trip=${tr.id}"
              style="grid-column: ${from + 2} / ${to + 3}; grid-row: ${lane + 1}" title="${escapeHtml(`${tr.number}: ${tr.from.city} → ${tr.to.city} · ${t(TRIP_STATUS[tr.status])}`)}">
            <strong>${escapeHtml(tr.number)}</strong><span data-no-i18n>${escapeHtml(tr.from.city)} → ${escapeHtml(tr.to.city)}</span></a>`;
        })
        .join('')}
    </div>`;
}

function renderFree() {
  const free = freeVehicles(selected);
  const date = new Date(`${selected}T00:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  $('freeInfo').innerHTML = free.length
    ? `${t('Вільні {date}:', { date })} ${free
        .map((v) => `<span class="schedule-free__item">${plate(v.plate, { small: true })} <span data-no-i18n>${escapeHtml(v.type || v.model)} · ${v.capacityT} т</span></span>`)
        .join('')}`
    : t('{date}: вільних машин немає', { date });
}

grid.addEventListener('click', (e) => {
  const day = e.target.closest('[data-day]');
  if (!day) return;
  selected = day.dataset.day;
  render();
  grid.querySelector(`[data-day="${selected}"]`)?.focus();
});

$('prevWeek').addEventListener('click', () => {
  start = addDays(start, -7);
  render();
});
$('nextWeek').addEventListener('click', () => {
  start = addDays(start, 7);
  render();
});
$('thisWeek').addEventListener('click', () => {
  start = monday(new Date());
  selected = ymd(new Date());
  render();
});

async function init() {
  [trips, vehicles, drivers] = await Promise.all([getTrips(), getVehicles(), getDrivers()]);
  const day = new URLSearchParams(location.search).get('date');
  if (/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
    selected = day;
    start = monday(new Date(`${day}T00:00:00`));
  }
  render();
}

init();

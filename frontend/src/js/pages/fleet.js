// Автопарк: стан машин (ТО, страховка) і список водіїв
import { locale, t } from '../i18n/index.js';
import { renderLayout } from '../utils/layout.js';
import { getVehicles } from '../api/vehicles.js';
import { getDrivers } from '../api/drivers.js';
import { getTrips } from '../api/trips.js';
import { escapeHtml, VEHICLE_STATUS, DRIVER_STATUS } from '../utils/format.js';
import { plate, statusBadge } from '../utils/components.js';
import { icons } from '../utils/icons.js';
import { load, save } from '../utils/storage.js';

renderLayout();

const SERVICE_INTERVAL_KM = 30000; // інтервал планового ТО
const SERVICE_WARN_KM = 3000;
const INSURANCE_WARN_DAYS = 45;

let vehicles = [];
let drivers = [];
let trips = [];

const nf = (n) => n.toLocaleString(locale());
const daysUntil = (iso) => Math.ceil((new Date(`${iso}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 864e5);
const activeTripOf = (key, id) => trips.find((t) => t[key] === id && t.status === 'in_progress');

// ---------- Стан ТО та страховки ----------
function serviceState(v) {
  const left = v.nextServiceKm - v.mileageKm;
  const used = Math.min(1, Math.max(0, 1 - left / SERVICE_INTERVAL_KM));
  if (left < 0) return { left, used: 1, tone: 'bad', text: `Прострочене на ${nf(-left)} км` };
  if (left <= SERVICE_WARN_KM) return { left, used, tone: 'warn', text: `${nf(left)} км` };
  return { left, used, tone: 'ok', text: `${nf(left)} км` };
}

function insuranceState(v) {
  const days = daysUntil(v.insuranceUntil);
  const date = new Date(`${v.insuranceUntil}T00:00:00`).toLocaleDateString(locale());
  if (days < 0) return { tone: 'bad', label: 'Страховка', text: 'прострочена' };
  if (days <= INSURANCE_WARN_DAYS) return { tone: 'warn', label: `Страховка · ${days} дн.`, text: date };
  return { tone: 'ok', label: 'Страховка до', text: date };
}

// ---------- Автомобілі ----------
function renderVehicles() {
  const order = { on_trip: 0, available: 1, repair: 2 };
  document.getElementById('vehicles').innerHTML = [...vehicles]
    .sort((a, b) => order[a.status] - order[b.status])
    .map((v) => {
      const s = serviceState(v);
      const ins = insuranceState(v);
      const driver = drivers.find((d) => d.vehicleId === v.id);
      const trip = activeTripOf('vehicleId', v.id);
      return `
      <article class="vehicle">
        <header class="vehicle__head">
          ${plate(v.plate)}
          ${statusBadge(v.status, VEHICLE_STATUS)}
        </header>
        <div>
          <h2 class="vehicle__model">${escapeHtml(v.model)}</h2>
          <p class="vehicle__spec">${escapeHtml(v.type)} · ${v.capacityT} т · ${v.fuelConsumption} л/100 км</p>
        </div>

        <div class="meter meter--${s.tone}">
          <div class="meter__row"><span>До ТО</span><strong>${s.text}</strong></div>
          <span class="meter__track" role="img" aria-label="Використано ${Math.round(s.used * 100)} % інтервалу ТО"><span class="meter__fill" style="width:${s.used * 100}%"></span></span>
        </div>

        <dl class="vehicle__facts">
          <div><dt>Пробіг</dt><dd>${nf(v.mileageKm)} км</dd></div>
          <div class="is-${ins.tone}"><dt>${ins.label}</dt><dd>${ins.text}</dd></div>
        </dl>

        <footer class="vehicle__foot">
          ${icons.profile}<span>${driver ? escapeHtml(driver.name) : 'Водія не призначено'}</span>
          ${trip ? `<a class="vehicle__trip" href="/pages/trips.html?trip=${trip.id}">${escapeHtml(trip.number)} · ${escapeHtml(trip.to.city)}</a>` : ''}
        </footer>
      </article>`;
    })
    .join('');
}

// ---------- Водії ----------
function renderDrivers() {
  document.getElementById('driversBody').innerHTML = drivers
    .map((d) => {
      const v = vehicles.find((x) => x.id === d.vehicleId);
      const trip = activeTripOf('driverId', d.id);
      const viber = `viber://chat?number=${encodeURIComponent(d.viber || d.phone)}`;
      return `
      <tr>
        <td><strong>${escapeHtml(d.name)}</strong><span class="sub">Категорії ${d.licenseCategories.join(', ')}</span></td>
        <td><a href="tel:${d.phone}" class="drivers-table__phone">${d.phone}</a></td>
        <td>${v ? plate(v.plate, { small: true }) : '—'}</td>
        <td class="num">${d.ratePerKm} грн/км</td>
        <td>${trip ? `<a href="/pages/trips.html?trip=${trip.id}">${escapeHtml(trip.number)}</a><span class="sub">${escapeHtml(trip.from.city)} → ${escapeHtml(trip.to.city)}</span>` : '<span class="sub">—</span>'}</td>
        <td>${statusBadge(d.status, DRIVER_STATUS)}</td>
        <td class="trip-tr__actions">
          <a class="icon-btn" href="tel:${d.phone}" title="Подзвонити" aria-label="Подзвонити: ${escapeHtml(d.name)}">${icons.phone}</a>
          <a class="icon-btn" href="${viber}" title="Написати у Viber" aria-label="Написати у Viber: ${escapeHtml(d.name)}">${icons.send}</a>
        </td>
      </tr>`;
    })
    .join('');
}

// ---------- Попередження вгорі ----------
function renderSummary() {
  const onTrip = vehicles.filter((v) => v.status === 'on_trip').length;
  const free = vehicles.filter((v) => v.status === 'available').length;
  document.getElementById('fleetSummary').textContent = t('{n} машин · {m} в рейсі · {k} вільні', { n: vehicles.length, m: onTrip, k: free });
  document.getElementById('vehiclesCount').textContent = vehicles.length;
  document.getElementById('driversCount').textContent = drivers.length;

  const service = vehicles.filter((v) => serviceState(v).tone !== 'ok').length;
  const insurance = vehicles.filter((v) => insuranceState(v).tone !== 'ok').length;
  const parts = [];
  if (service) parts.push(t(service === 1 ? '{n} машині скоро ТО' : '{n} машинам скоро ТО', { n: service }));
  if (insurance) parts.push(t(insurance === 1 ? '{n} страховка закінчується' : '{n} страховки закінчуються', { n: insurance }));
  const note = document.getElementById('fleetAlerts');
  note.innerHTML = parts.length ? `${icons.wrench}<span>${parts.join(', ')}</span>` : '';
}

// ---------- Вкладки ----------
const tabButtons = [...document.querySelectorAll('[role="tab"]')];

function selectTab(name, focus = false) {
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
    document.getElementById(b.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) b.focus();
  });
  save('fleetTab', name);
}

tabButtons.forEach((b, i) => {
  b.addEventListener('click', () => selectTab(b.dataset.tab));
  b.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabButtons[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabButtons.length) % tabButtons.length];
    selectTab(next.dataset.tab, true);
  });
});

async function init() {
  [vehicles, drivers, trips] = await Promise.all([getVehicles(), getDrivers(), getTrips()]);
  renderSummary();
  renderVehicles();
  renderDrivers();
  selectTab(load('fleetTab') === 'drivers' ? 'drivers' : 'vehicles');
}

init();

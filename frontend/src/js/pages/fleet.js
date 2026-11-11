// Автопарк: машини (стан, ТО, страховка) і водії. Додавання, редагування, видалення,
// закріплення машини за водієм і швидка зміна стану машини.
import { locale, t } from '../i18n/index.js';
import { renderLayout } from '../utils/layout.js';
import { getVehicles, createVehicle, updateVehicle, setVehicleStatus, deleteVehicle } from '../api/vehicles.js';
import { getDrivers, createDriver, updateDriver, assignVehicle, deleteDriver } from '../api/drivers.js';
import { getTrips } from '../api/trips.js';
import { getDocumentsSummary, VEHICLE_DOC_TYPES, DRIVER_DOC_TYPES } from '../api/documents.js';
import { openDocuments } from './documents.js';
import { escapeHtml, VEHICLE_STATUS, VEHICLE_BUSY, DRIVER_STATUS } from '../utils/format.js';
import { plate, statusBadge } from '../utils/components.js';
import { icons } from '../utils/icons.js';
import { load, save } from '../utils/storage.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import {
  setFieldError,
  clearErrors,
  showAlert,
  withLoading,
  fullNameError,
  normalizeName,
  capitalizeName,
  phoneDigits,
  phoneError,
  toE164,
} from '../utils/validation.js';

renderLayout();

const SERVICE_INTERVAL_KM = 30000; // інтервал планового ТО
const SERVICE_WARN_KM = 3000;
const INSURANCE_WARN_DAYS = 45;
const $ = (id) => document.getElementById(id);

let vehicles = [];
let drivers = [];
let trips = [];
let tab = 'vehicles';
let docSummary = { vehicles: {}, drivers: {} }; // кількість копій документів і прострочені

// Кнопка «Документи» з лічильником; червона крапка — якщо документ прострочено чи скоро закінчиться
function docsButton(ownerType, id, label) {
  const s = docSummary[ownerType][id] ?? { count: 0, expiring: 0, expired: 0 };
  const alert = s.expired ? 'bad' : s.expiring ? 'warn' : '';
  const hint = s.expired ? t('є прострочені') : s.expiring ? t('скоро закінчуються') : '';
  return `<button class="icon-btn docs-btn${alert ? ` docs-btn--${alert}` : ''}" type="button" data-docs="${ownerType}:${id}"
    title="${escapeHtml([t('Документи ({n})', { n: s.count }), hint].filter(Boolean).join(' · '))}" aria-label="${escapeHtml(t('Документи: {name}', { name: label }) + ` (${s.count})`)}">
    ${icons.doc}${s.count ? `<span class="docs-btn__count">${s.count}</span>` : ''}</button>`;
}

async function loadDocSummary() {
  try {
    const [vehicles, drivers] = await Promise.all([getDocumentsSummary('vehicles'), getDocumentsSummary('drivers')]);
    docSummary = { vehicles, drivers };
  } catch {
    // лічильники не критичні — сторінка працює і без них
  }
}

const nf = (n) => Number(n).toLocaleString(locale());
const daysUntil = (iso) => Math.ceil((new Date(`${iso}T00:00:00`) - new Date().setHours(0, 0, 0, 0)) / 864e5);
const activeTripOf = (key, id) => trips.find((tr) => tr[key] === id && tr.status === 'in_progress');
const driverOfVehicle = (vehicleId) => drivers.find((d) => vehicleId && d.vehicleId === vehicleId);

// «5 хвилин тому» / «5 minutes ago» — коли востаннє змінювали стан
function ago(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), 'minute');
  if (minutes < 60 * 24) return rtf.format(-Math.round(minutes / 60), 'hour');
  return rtf.format(-Math.round(minutes / 1440), 'day');
}

// ---------- Стан ТО та страховки ----------
function serviceState(v) {
  if (!v.nextServiceKm) return { used: 0, tone: 'none', text: 'не вказано' };
  const left = v.nextServiceKm - v.mileageKm;
  const used = Math.min(1, Math.max(0, 1 - left / SERVICE_INTERVAL_KM));
  if (left < 0) return { used: 1, tone: 'bad', text: t('Прострочене на {n} км', { n: nf(-left) }) };
  if (left <= SERVICE_WARN_KM) return { used, tone: 'warn', text: `${nf(left)} км` };
  return { used, tone: 'ok', text: `${nf(left)} км` };
}

function insuranceState(v) {
  if (!v.insuranceUntil) return { tone: 'none', label: 'Страховка', text: 'не вказано' };
  const days = daysUntil(v.insuranceUntil);
  const date = new Date(`${v.insuranceUntil}T00:00:00`).toLocaleDateString(locale());
  if (days < 0) return { tone: 'bad', label: 'Страховка', text: 'прострочена' };
  if (days <= INSURANCE_WARN_DAYS) return { tone: 'warn', label: t('Страховка · {n} дн.', { n: days }), text: date };
  return { tone: 'ok', label: 'Страховка до', text: date };
}

const statusOptions = (labels, current) =>
  Object.entries(labels)
    .map(([value, label]) => `<option value="${value}" ${value === current ? 'selected' : ''}>${label}</option>`)
    .join('');

// ---------- Автомобілі ----------
function renderVehicles() {
  const order = Object.keys(VEHICLE_STATUS);
  const list = [...vehicles].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  $('vehicles').innerHTML = list.length
    ? list
        .map((v) => {
          const s = serviceState(v);
          const ins = insuranceState(v);
          const driver = driverOfVehicle(v.id);
          const trip = activeTripOf('vehicleId', v.id);
          return `
      <article class="vehicle" data-id="${v.id}">
        <header class="vehicle__head">
          ${plate(v.plate)}
          <label class="status-select status-select--${v.status}">
            <span class="visually-hidden">${t('Стан машини {plate}', { plate: v.plate })}</span>
            <select data-status-for="${v.id}">${statusOptions(VEHICLE_STATUS, v.status)}</select>
          </label>
        </header>
        <div>
          <h2 class="vehicle__model" data-no-i18n>${escapeHtml(v.model)}</h2>
          <p class="vehicle__spec">${escapeHtml(v.type || '—')} · ${nf(v.capacityT)} т · ${nf(v.fuelConsumption)} л/100 км</p>
          ${v.statusUpdatedAt ? `<p class="vehicle__updated">${t('Стан оновлено {ago}', { ago: ago(v.statusUpdatedAt) })}</p>` : ''}
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
          ${icons.profile}
          ${
            driver
              ? `<span data-no-i18n>${escapeHtml(driver.name)}</span>`
              : `<button class="link-btn" type="button" data-edit-vehicle="${v.id}" data-focus="vfDriver">Призначити водія</button>`
          }
          ${trip ? `<a class="vehicle__trip" href="/pages/trips.html?trip=${trip.id}">${escapeHtml(trip.number)} · <span data-no-i18n>${escapeHtml(trip.to.city)}</span></a>` : ''}
          <span class="vehicle__tools">
            ${docsButton('vehicles', v.id, v.plate)}
            <button class="icon-btn" type="button" data-edit-vehicle="${v.id}" title="Редагувати" aria-label="${escapeHtml(t('Редагувати машину {plate}', { plate: v.plate }))}">${icons.edit}</button>
            <button class="icon-btn icon-btn--danger" type="button" data-delete-vehicle="${v.id}" title="Видалити" aria-label="${escapeHtml(t('Видалити машину {plate}', { plate: v.plate }))}">${icons.trash}</button>
          </span>
        </footer>
      </article>`;
        })
        .join('')
    : `<div class="empty"><p class="empty__title">У автопарку ще немає машин</p><button class="btn" type="button" data-add>Додати машину</button></div>`;
}

// ---------- Водії ----------
// Машини для вибору; зайняті іншими водіями підписані ім'ям водія
function vehicleOptions(selectedId, forDriverId) {
  return (
    `<option value="">Без машини</option>` +
    vehicles
      .map((v) => {
        const holder = driverOfVehicle(v.id);
        const busy = holder && holder.id !== forDriverId ? ` — ${holder.name.split(' ')[0]}` : '';
        return `<option value="${v.id}" ${v.id === selectedId ? 'selected' : ''}>${escapeHtml(`${v.plate} · ${v.model}${busy}`)}</option>`;
      })
      .join('')
  );
}

function renderDrivers() {
  $('driversBody').innerHTML = drivers.length
    ? drivers
        .map((d) => {
          const trip = activeTripOf('driverId', d.id);
          const viber = `viber://chat?number=${encodeURIComponent(d.viber || d.phone)}`;
          return `
      <tr data-id="${d.id}">
        <td><strong data-no-i18n>${escapeHtml(d.name)}</strong><span class="sub">${t('Категорії {list}', { list: (d.licenseCategories ?? []).join(', ') || '—' })}</span></td>
        <td><a href="tel:${escapeHtml(d.phone)}" class="drivers-table__phone">${escapeHtml(d.phone)}</a></td>
        <td>
          <label class="visually-hidden" for="veh-${d.id}">${escapeHtml(t('Машина водія {name}', { name: d.name }))}</label>
          <select class="input input--compact" id="veh-${d.id}" data-assign="${d.id}" data-no-i18n>${vehicleOptions(d.vehicleId, d.id)}</select>
        </td>
        <td class="num">${nf(d.ratePerKm)} грн/км</td>
        <td>${trip ? `<a href="/pages/trips.html?trip=${trip.id}">${escapeHtml(trip.number)}</a><span class="sub" data-no-i18n>${escapeHtml(trip.from.city)} → ${escapeHtml(trip.to.city)}</span>` : '<span class="sub">—</span>'}</td>
        <td>${statusBadge(d.status, DRIVER_STATUS)}</td>
        <td class="trip-tr__actions">
          <a class="icon-btn" href="tel:${escapeHtml(d.phone)}" title="Подзвонити" aria-label="Подзвонити: ${escapeHtml(d.name)}">${icons.phone}</a>
          <a class="icon-btn" href="${viber}" title="Написати у Viber" aria-label="Написати у Viber: ${escapeHtml(d.name)}">${icons.send}</a>
          ${docsButton('drivers', d.id, d.name)}
          <button class="icon-btn" type="button" data-edit-driver="${d.id}" title="Редагувати" aria-label="${escapeHtml(t('Редагувати водія {name}', { name: d.name }))}">${icons.edit}</button>
          <button class="icon-btn icon-btn--danger" type="button" data-delete-driver="${d.id}" title="Видалити" aria-label="${escapeHtml(t('Видалити водія {name}', { name: d.name }))}">${icons.trash}</button>
        </td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="7"><div class="empty"><p class="empty__title">Водіїв ще немає</p><button class="btn" type="button" data-add>Додати водія</button></div></td></tr>`;
}

// ---------- Підсумок і попередження вгорі ----------
function renderSummary() {
  const busy = vehicles.filter((v) => VEHICLE_BUSY.includes(v.status)).length;
  const free = vehicles.filter((v) => v.status === 'available').length;
  const broken = vehicles.filter((v) => v.status === 'broken').length;
  $('fleetSummary').textContent = [
    t('{n} машин · {m} в рейсі · {k} вільні', { n: vehicles.length, m: busy, k: free }),
    broken ? t('зламаних: {n}', { n: broken }) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  $('vehiclesCount').textContent = vehicles.length;
  $('driversCount').textContent = drivers.length;

  const service = vehicles.filter((v) => ['warn', 'bad'].includes(serviceState(v).tone)).length;
  const insurance = vehicles.filter((v) => ['warn', 'bad'].includes(insuranceState(v).tone)).length;
  const parts = [];
  if (service) parts.push(t(service === 1 ? '{n} машині скоро ТО' : '{n} машинам скоро ТО', { n: service }));
  if (insurance) parts.push(t(insurance === 1 ? '{n} страховка закінчується' : '{n} страховки закінчуються', { n: insurance }));
  $('fleetAlerts').innerHTML = parts.length ? `${icons.wrench}<span>${parts.join(', ')}</span>` : '';
}

function renderAll() {
  renderSummary();
  renderVehicles();
  renderDrivers();
}

async function reload({ withTrips = false } = {}) {
  [vehicles, drivers, trips] = await Promise.all([getVehicles(), getDrivers(), withTrips ? getTrips() : trips, withTrips && loadDocSummary()]);
  renderAll();
}

// ---------- Вкладки ----------
const tabButtons = [...document.querySelectorAll('[role="tab"]')];

function selectTab(name, focus = false) {
  tab = name;
  tabButtons.forEach((b) => {
    const active = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(active));
    b.tabIndex = active ? 0 : -1;
    $(b.getAttribute('aria-controls')).hidden = !active;
    if (active && focus) b.focus();
  });
  $('addBtn').textContent = name === 'drivers' ? 'Додати водія' : 'Додати машину';
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

// ============================================================
// Форма машини
// ============================================================
const vDialog = $('vehicleDialog');
const vForm = $('vehicleForm');
let editingVehicle = null;

// «вх1234ak» → «ВХ 1234 АК»: латинські літери-двійники перетворюємо на кирилицю
const LATIN_TO_CYR = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', I: 'І', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х' };
function normalizePlate(value) {
  const raw = value.toUpperCase().replace(/[\s-]/g, '').replace(/[ABCEHIKMOPTX]/g, (c) => LATIN_TO_CYR[c]);
  const m = raw.match(/^([А-ЯІЇЄ]{2})(\d{4})([А-ЯІЇЄ]{2})$/);
  return m ? `${m[1]} ${m[2]} ${m[3]}` : null;
}

function openVehicleForm(vehicle = null, focusId = '') {
  editingVehicle = vehicle;
  vForm.reset();
  clearErrors(vForm);
  $('vehicleTitle').textContent = vehicle ? t('Машина {plate}', { plate: vehicle.plate }) : 'Нова машина';
  $('vfStatus').innerHTML = statusOptions(VEHICLE_STATUS, vehicle?.status ?? 'available');
  const holder = vehicle ? driverOfVehicle(vehicle.id) : null;
  $('vfDriver').innerHTML =
    `<option value="">Без водія</option>` +
    drivers
      .map((d) => {
        const other = d.vehicleId && d.vehicleId !== vehicle?.id ? vehicles.find((v) => v.id === d.vehicleId) : null;
        return `<option value="${d.id}" ${d.id === holder?.id ? 'selected' : ''}>${escapeHtml(d.name + (other ? ` — ${other.plate}` : ''))}</option>`;
      })
      .join('');
  if (vehicle) {
    $('vfPlate').value = vehicle.plate;
    $('vfModel').value = vehicle.model;
    $('vfType').value = vehicle.type ?? '';
    $('vfCapacity').value = vehicle.capacityT;
    $('vfFuel').value = vehicle.fuelConsumption;
    $('vfMileage').value = vehicle.mileageKm;
    $('vfService').value = vehicle.nextServiceKm ?? '';
    $('vfInsurance').value = vehicle.insuranceUntil ?? '';
  }
  vDialog.showModal();
  $(focusId || 'vfPlate').focus();
}

vForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(vForm);
  const num = (id) => ($(id).value === '' ? null : Number($(id).value));
  const plateValue = normalizePlate($('vfPlate').value);
  const errors = [
    ['vfPlate', !plateValue && 'Номер у форматі «ВХ 1234 АК»'],
    ['vfModel', !$('vfModel').value.trim() && 'Вкажіть марку й модель'],
    ['vfCapacity', !(num('vfCapacity') > 0) && 'Вкажіть вантажопідйомність у тоннах'],
    ['vfFuel', !(num('vfFuel') > 0) && 'Вкажіть витрату пального'],
    ['vfMileage', (num('vfMileage') === null || num('vfMileage') < 0) && 'Вкажіть пробіг'],
  ].filter(([, msg]) => msg);
  errors.forEach(([id, msg]) => setFieldError($(id), msg));
  if (errors.length) return $(errors[0][0]).focus();

  const data = {
    plate: plateValue,
    model: $('vfModel').value.trim(),
    type: $('vfType').value.trim(),
    capacityT: num('vfCapacity'),
    fuelConsumption: num('vfFuel'),
    mileageKm: num('vfMileage'),
    nextServiceKm: num('vfService'),
    insuranceUntil: $('vfInsurance').value || null,
    status: $('vfStatus').value,
  };
  const driverId = $('vfDriver').value;
  const wasEditing = Boolean(editingVehicle);
  try {
    await withLoading(vForm.querySelector('[type=submit]'), async () => {
      const saved = wasEditing ? await updateVehicle(editingVehicle.id, data) : await createVehicle(data);
      // водій: закріпити вибраного або зняти попереднього
      const holder = driverOfVehicle(saved.id);
      if (driverId && driverId !== holder?.id) await assignVehicle(driverId, saved.id);
      if (!driverId && holder) await assignVehicle(holder.id, null);
    });
    vDialog.close();
    showToast(wasEditing ? 'Зміни збережено' : t('Машину {plate} додано', { plate: plateValue }));
    await reload();
  } catch (err) {
    if (err.code === 'plate_taken') setFieldError($('vfPlate'), err.message);
    else showAlert(vForm, err.message);
  }
});

// ============================================================
// Форма водія
// ============================================================
const dDialog = $('driverDialog');
const dForm = $('driverForm');
let editingDriver = null;

function openDriverForm(driver = null) {
  editingDriver = driver;
  dForm.reset();
  clearErrors(dForm);
  $('driverTitle').textContent = driver ? 'Дані водія' : 'Новий водій';
  $('dfStatus').innerHTML = statusOptions(DRIVER_STATUS, driver?.status ?? 'available');
  $('dfVehicle').innerHTML = vehicleOptions(driver?.vehicleId ?? '', driver?.id);
  $('dfVehicleHint').hidden = true;
  const categories = driver ? driver.licenseCategories ?? [] : ['C', 'CE'];
  dForm.querySelectorAll('#dfCategories input').forEach((c) => (c.checked = categories.includes(c.value)));
  $('dfRate').value = driver?.ratePerKm ?? 10;
  if (driver) {
    $('dfName').value = driver.name;
    $('dfPhone').value = driver.phone;
    $('dfViber').value = driver.viber && driver.viber !== driver.phone ? driver.viber : '';
  }
  dDialog.showModal();
  $('dfName').focus();
}

// Підказка: машину заберуть в іншого водія
$('dfVehicle').addEventListener('change', () => {
  const holder = driverOfVehicle($('dfVehicle').value);
  const hint = $('dfVehicleHint');
  hint.hidden = !holder || holder.id === editingDriver?.id;
  if (!hint.hidden) hint.textContent = t('Машина зараз закріплена за іншим водієм ({name}) — її буде переведено.', { name: holder.name });
});

dForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(dForm);
  const name = capitalizeName(normalizeName($('dfName').value));
  const viberRaw = $('dfViber').value.trim();
  const categories = [...dForm.querySelectorAll('#dfCategories input:checked')].map((c) => c.value);
  const rate = Number($('dfRate').value);
  const errors = [
    ['dfName', fullNameError(name, { maxWords: 3 })],
    ['dfPhone', phoneError($('dfPhone').value)],
    ['dfViber', viberRaw && phoneError(viberRaw)],
    ['dfRate', !(rate > 0) && 'Вкажіть ставку в грн за км'],
  ].filter(([, msg]) => msg);
  errors.forEach(([id, msg]) => setFieldError($(id), msg));
  if (!categories.length) {
    setFieldError($('dfCategories').querySelector('input'), 'Позначте хоча б одну категорію');
    if (!errors.length) $('dfCategories').querySelector('input').focus();
    return;
  }
  if (errors.length) return $(errors[0][0]).focus();

  const phone = toE164(phoneDigits($('dfPhone').value));
  const data = {
    name,
    phone,
    viber: viberRaw ? toE164(phoneDigits(viberRaw)) : phone,
    licenseCategories: categories,
    ratePerKm: rate,
    status: $('dfStatus').value,
    vehicleId: $('dfVehicle').value || null,
  };
  const wasEditing = Boolean(editingDriver);
  try {
    await withLoading(dForm.querySelector('[type=submit]'), () => (wasEditing ? updateDriver(editingDriver.id, data) : createDriver(data)));
    dDialog.close();
    showToast(wasEditing ? 'Зміни збережено' : t('Водія {name} додано', { name }));
    await reload();
  } catch (err) {
    showAlert(dForm, err.message);
  }
});

[vDialog, dDialog].forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d || e.target.closest('[data-cancel]')) d.close();
  })
);

// ============================================================
// Дії на сторінці
// ============================================================
$('addBtn').addEventListener('click', () => (tab === 'drivers' ? openDriverForm() : openVehicleForm()));

async function removeItem({ title, text, action, done }) {
  if (!(await confirmDialog({ title, text }))) return;
  try {
    await action();
    showToast(done);
    await reload({ withTrips: true });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

document.querySelector('.main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-edit-vehicle],[data-delete-vehicle],[data-edit-driver],[data-delete-driver],[data-add],[data-docs]');
  if (!el) return;
  const ds = el.dataset;

  if (ds.docs) {
    const [ownerType, id] = ds.docs.split(':');
    const isVehicle = ownerType === 'vehicles';
    const item = (isVehicle ? vehicles : drivers).find((x) => x.id === id);
    return openDocuments({
      ownerType,
      ownerId: id,
      title: isVehicle ? 'Документи машини' : 'Документи водія',
      owner: isVehicle ? `${item.plate} · ${item.model}` : item.name,
      types: isVehicle ? VEHICLE_DOC_TYPES : DRIVER_DOC_TYPES,
      onChange: async () => {
        await loadDocSummary();
        renderAll();
      },
    });
  }

  if ('add' in ds) return tab === 'drivers' ? openDriverForm() : openVehicleForm();
  if (ds.editVehicle) return openVehicleForm(vehicles.find((v) => v.id === ds.editVehicle), ds.focus);
  if (ds.editDriver) return openDriverForm(drivers.find((d) => d.id === ds.editDriver));

  if (ds.deleteVehicle) {
    const v = vehicles.find((x) => x.id === ds.deleteVehicle);
    const planned = trips.filter((tr) => tr.vehicleId === v.id && tr.status === 'planned').length;
    removeItem({
      title: t('Видалити машину {plate}?', { plate: v.plate }),
      text: planned
        ? t('Її буде знято із запланованих рейсів ({n}). Дію не можна скасувати.', { n: planned })
        : 'Машину буде прибрано з автопарку. Дію не можна скасувати.',
      action: () => deleteVehicle(v.id),
      done: t('Машину {plate} видалено', { plate: v.plate }),
    });
  }

  if (ds.deleteDriver) {
    const d = drivers.find((x) => x.id === ds.deleteDriver);
    const planned = trips.filter((tr) => tr.driverId === d.id && tr.status === 'planned').length;
    removeItem({
      title: t('Видалити водія {name}?', { name: d.name }),
      text: planned
        ? t('Його буде знято із запланованих рейсів ({n}). Дію не можна скасувати.', { n: planned })
        : 'Водія буде прибрано зі списку. Дію не можна скасувати.',
      action: () => deleteDriver(d.id),
      done: t('Водія {name} видалено', { name: d.name }),
    });
  }
});

// Швидка зміна стану машини і закріплення машини за водієм — прямо зі списку
document.querySelector('.main').addEventListener('change', async (e) => {
  const statusSelect = e.target.closest('[data-status-for]');
  if (statusSelect) {
    const v = vehicles.find((x) => x.id === statusSelect.dataset.statusFor);
    const prev = v.status;
    statusSelect.disabled = true;
    try {
      Object.assign(v, await setVehicleStatus(v.id, statusSelect.value));
      showToast(t('{plate}: {status}', { plate: v.plate, status: t(VEHICLE_STATUS[v.status]) }));
      renderAll();
      document.querySelector(`[data-status-for="${v.id}"]`)?.focus();
    } catch (err) {
      statusSelect.value = prev;
      statusSelect.disabled = false;
      showToast(err.message, 'error');
    }
    return;
  }

  const assign = e.target.closest('[data-assign]');
  if (assign) {
    const d = drivers.find((x) => x.id === assign.dataset.assign);
    const vehicleId = assign.value || null;
    assign.disabled = true;
    try {
      await assignVehicle(d.id, vehicleId);
      const v = vehicles.find((x) => x.id === vehicleId);
      showToast(v ? t('Машину {plate} закріплено. Водій: {name}', { plate: v.plate, name: d.name }) : t('Водій {name} тепер без машини', { name: d.name }));
      await reload();
      document.querySelector(`[data-assign="${d.id}"]`)?.focus();
    } catch (err) {
      showToast(err.message, 'error');
      renderDrivers();
    }
  }
});

async function init() {
  [vehicles, drivers, trips] = await Promise.all([getVehicles(), getDrivers(), getTrips(), loadDocSummary()]);
  renderAll();
  selectTab(load('fleetTab') === 'drivers' ? 'drivers' : 'vehicles');
}

init();

// Форма «Новий рейс»: вручну або з оголошення Della (вставлений текст / кнопка-закладка в браузері)
import { createTrip, updateTrip } from '../api/trips.js';
import { parseDellaListing, dellaBookmarklet, dellaNotes, sameCargo } from '../utils/della.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';
import { escapeHtml, TRIP_STATUS } from '../utils/format.js';
import { t as tr } from '../i18n/index.js';

const dialog = document.getElementById('tripFormDialog');
const form = document.getElementById('tripForm');
const box = document.getElementById('dellaBox');
const pasteArea = document.getElementById('dellaText');
const result = document.getElementById('dellaResult');
const alertEl = document.getElementById('tripFormAlert');
const $ = (id) => document.getElementById(id);

const FIELD_LABELS = { route: 'маршрут', date: 'дату', cargo: 'вантаж', weight: 'вагу', distance: 'відстань', price: 'ціну' };

let ctx = { getTrips: () => [], drivers: [], vehicles: [], onCreated: () => {}, onUpdated: () => {} };
let editing = null; // рейс, який редагуємо (null — новий)
let imported = null; // дані, розпізнані з Della (для source/importedFrom)
let duplicateWarned = false;

/** Підключає форму до сторінки рейсів */
export function initTripForm(options) {
  ctx = { ...ctx, ...options };
  $('dellaBookmarklet').href = dellaBookmarklet();
  $('dellaBookmarklet').addEventListener('click', (e) => {
    e.preventDefault(); // це кнопка для перетягування на панель закладок, а не для кліку
    showAlert(form, 'Перетягніть кнопку «→ NeVpade» мишкою на панель закладок браузера.', 'warning');
  });

  // Прийшли з закладки на Della: дані в #della=…
  if (location.hash.startsWith('#della=')) {
    const text = decodeURIComponent(location.hash.slice('#della='.length));
    history.replaceState(null, '', location.pathname + location.search);
    openTripForm({ della: true, text });
  }
}

const fill = (id, value) => {
  const el = $(id);
  if (value === null || value === undefined || value === '') return;
  el.value = value;
  el.classList.add('is-autofilled');
};

// Редагування: усі поля з рейсу
function fillFromTrip(t) {
  const set = (id, v) => ($(id).value = v ?? '');
  set('tfFromCity', t.from.city);
  set('tfFromAddress', t.from.address);
  set('tfToCity', t.to.city);
  set('tfToAddress', t.to.address);
  set('tfLoadDate', t.loadDate);
  set('tfUnloadDate', t.unloadDate);
  set('tfCargo', t.cargo.type);
  set('tfWeight', t.cargo.weightT);
  set('tfVolume', t.cargo.volumeM3);
  set('tfDistance', t.distanceKm);
  set('tfPrice', t.price);
  set('tfClient', t.client?.name);
  set('tfClientPhone', t.client?.phone);
  set('tfDriver', t.driverId);
  set('tfVehicle', t.vehicleId);
  set('tfNotes', t.notes);
  set('tfStatus', t.status);
}

function fillOptions() {
  $('tfStatus').innerHTML = Object.entries(TRIP_STATUS).map(([v, label]) => `<option value="${v}">${label}</option>`).join('');
  $('tfDriver').innerHTML =
    `<option value="">Не призначено</option>` +
    ctx.drivers
      .filter((d) => d.status !== 'fired')
      .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
      .join('');
  $('tfVehicle').innerHTML =
    `<option value="">Не призначено</option>` +
    ctx.vehicles.map((v) => `<option value="${v.id}">${escapeHtml(v.plate)} · ${escapeHtml(v.model)}</option>`).join('');
}

/**
 * Відкрити форму.
 * della: true — показати блок вставки оголошення; text — одразу розпізнати цей текст;
 * listing — вантаж, уже розібраний зі сторінки пошуку Della; trip — редагувати цей рейс
 */
export function openTripForm({ della = false, text = '', listing = null, trip = null } = {}) {
  form.reset();
  clearErrors(form);
  alertEl.hidden = true;
  imported = null;
  editing = trip;
  duplicateWarned = false;
  form.querySelectorAll('.is-autofilled').forEach((el) => el.classList.remove('is-autofilled'));
  fillOptions();
  $('tripFormTitle').textContent = trip ? tr('Рейс {n}', { n: trip.number }) : della ? 'Новий рейс з Della' : 'Новий рейс';
  $('tfStatusField').hidden = !trip;
  form.querySelector('[type=submit]').textContent = trip ? 'Зберегти зміни' : 'Створити рейс';
  box.hidden = !della || Boolean(trip);
  if (trip) {
    fillFromTrip(trip);
    if (!dialog.open) dialog.showModal();
    $('tfFromCity').focus();
    return;
  }
  result.textContent = '';
  pasteArea.value = text;
  if (!dialog.open) dialog.showModal();
  if (listing) {
    box.hidden = true;
    applyParsed(listing);
    $(listing.price && listing.currency === 'UAH' ? 'tfCargo' : 'tfPrice').focus();
  } else if (text) applyDella(text);
  else (della ? pasteArea : $('tfFromCity')).focus();
}

function applyDella(text) {
  const d = parseDellaListing(text);
  if (!d.found.length) {
    result.className = 'della__result is-bad';
    result.textContent = 'Не вдалося розпізнати оголошення. Виділіть на Della весь блок вантажу (маршрут, вагу, ціну) і спробуйте ще раз.';
    return;
  }
  applyParsed(d);
}

function applyParsed(d) {
  form.querySelectorAll('.is-autofilled').forEach((el) => el.classList.remove('is-autofilled'));
  imported = d;

  fill('tfFromCity', d.from.city);
  fill('tfToCity', d.to.city);
  fill('tfFromAddress', d.from.region);
  fill('tfToAddress', d.to.region);
  fill('tfLoadDate', d.loadDate);
  fill('tfUnloadDate', d.unloadDate);
  fill('tfCargo', d.cargoType);
  fill('tfWeight', d.weightT);
  fill('tfVolume', d.volumeM3);
  fill('tfDistance', d.distanceKm);
  if (d.currency === 'UAH') fill('tfPrice', d.price);
  fill('tfClient', d.clientName);
  fill('tfClientPhone', d.clientPhone);

  // Примітка — це дані рейсу (їх бачать колеги), тому завжди українською, як на Della
  fill('tfNotes', dellaNotes(d));

  const got = d.found.filter((k) => !(k === 'price' && d.currency !== 'UAH')).map((k) => tr(FIELD_LABELS[k]));
  const missing = Object.keys(FIELD_LABELS)
    .filter((k) => !d.found.includes(k) || (k === 'price' && d.currency !== 'UAH'))
    .map((k) => tr(FIELD_LABELS[k]));
  result.className = `della__result ${missing.length ? 'is-partial' : 'is-ok'}`;
  result.textContent = missing.length
    ? tr('Заповнено: {got}. Допишіть: {missing}.', { got: got.join(', '), missing: missing.join(', ') })
    : 'Усі основні поля заповнено. Перевірте дані й створіть рейс.';
  // Вантаж зі списку Della: блоку вставки не видно — підказку показуємо над кнопками
  if (box.hidden && missing.length) showAlert(form, tr('Допишіть: {missing}.', { missing: missing.join(', ') }), 'warning');
}

$('dellaParse').addEventListener('click', () => {
  if (!pasteArea.value.trim()) {
    result.className = 'della__result is-bad';
    result.textContent = 'Спершу вставте текст оголошення.';
    pasteArea.focus();
    return;
  }
  applyDella(pasteArea.value);
});

// Вставили текст — розпізнаємо одразу, без натискання кнопки
pasteArea.addEventListener('paste', () => setTimeout(() => applyDella(pasteArea.value), 0));

// Поле, змінене вручну, більше не підсвічується як «з Della»
form.addEventListener('input', (e) => e.target.classList?.remove('is-autofilled'));

$('tripFormCancel').addEventListener('click', () => dialog.close());

// Обрали водія — підставляємо закріплену за ним машину
$('tfDriver').addEventListener('change', () => {
  const driver = ctx.drivers.find((d) => d.id === $('tfDriver').value);
  if (driver?.vehicleId && ctx.vehicles.some((v) => v.id === driver.vehicleId)) $('tfVehicle').value = driver.vehicleId;
});

// ---------- Збереження ----------
const value = (id) => $(id).value.trim();
const number = (id) => (value(id) === '' ? null : Number(value(id)));

function validate() {
  clearErrors(form);
  const checks = [
    ['tfFromCity', !value('tfFromCity') && 'Вкажіть місто завантаження'],
    ['tfToCity', !value('tfToCity') && 'Вкажіть місто розвантаження'],
    ['tfLoadDate', !value('tfLoadDate') && 'Вкажіть дату завантаження'],
    ['tfUnloadDate', value('tfUnloadDate') && value('tfUnloadDate') < value('tfLoadDate') && 'Розвантаження не може бути раніше завантаження'],
    ['tfCargo', !value('tfCargo') && 'Вкажіть, що веземо'],
    ['tfWeight', !(number('tfWeight') > 0) && 'Вкажіть вагу в тоннах'],
    ['tfDistance', !(number('tfDistance') > 0) && 'Вкажіть відстань у кілометрах'],
    ['tfPrice', !(number('tfPrice') > 0) && 'Вкажіть вартість рейсу в гривнях'],
  ].filter(([, error]) => error);
  checks.forEach(([id, error]) => setFieldError($(id), error));
  if (checks.length) $(checks[0][0]).focus();
  return !checks.length;
}

// Такий самий вантаж уже є? (щоб не імпортувати одне оголошення двічі)
const findDuplicate = (data) => ctx.getTrips().find((t) => sameCargo(t, { ...data, weightT: data.cargo.weightT }));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  alertEl.hidden = true;
  if (!validate()) return;

  const data = {
    from: { city: value('tfFromCity'), address: value('tfFromAddress') },
    to: { city: value('tfToCity'), address: value('tfToAddress') },
    loadDate: value('tfLoadDate'),
    unloadDate: value('tfUnloadDate') || null,
    cargo: { type: value('tfCargo'), weightT: number('tfWeight'), volumeM3: number('tfVolume') },
    distanceKm: Math.round(number('tfDistance')),
    price: Math.round(number('tfPrice')),
    client: { name: value('tfClient'), phone: value('tfClientPhone') },
    driverId: value('tfDriver') || null,
    vehicleId: value('tfVehicle') || null,
    notes: value('tfNotes'),
    source: imported ? 'import' : 'manual',
    importedFrom: imported ? { platform: 'della', url: imported.url || null } : null,
  };

  if (editing) {
    // місто чи адресу змінили — старі координати вже не підходять
    const place = (key) => {
      const old = editing[key];
      const same = old.city === data[key].city && (old.address ?? '') === data[key].address;
      return same ? { ...old, ...data[key] } : data[key];
    };
    const changes = { ...data, from: place('from'), to: place('to'), status: value('tfStatus') };
    delete changes.source; // звідки рейс узявся — не змінюється
    delete changes.importedFrom;
    try {
      const trip = await withLoading(form.querySelector('[type=submit]'), () => updateTrip(editing.id, changes));
      dialog.close();
      ctx.onUpdated(trip);
    } catch (err) {
      showAlert(form, err.message);
    }
    return;
  }

  const dup = findDuplicate(data);
  if (dup && !duplicateWarned) {
    duplicateWarned = true;
    showAlert(form, tr('Схоже, цей вантаж уже є: рейс {n}. Натисніть «Створити рейс» ще раз, якщо це інший вантаж.', { n: dup.number }), 'warning');
    return;
  }

  const button = form.querySelector('[type=submit]');
  try {
    const trip = await withLoading(button, () => createTrip(data));
    dialog.close();
    ctx.onCreated(trip);
  } catch (err) {
    showAlert(form, err.message);
  }
});

// Рейси: список з фільтром за статусом, пошук і картка рейсу в бічній панелі
import { renderLayout } from '../utils/layout.js';
import { getTrips, calculateTrip, transferTrip, deleteTrip, myId } from '../api/trips.js';
import { getMembers } from '../api/company.js';
import { shortName, avatar } from '../utils/people.js';
import { t as tr, locale } from '../i18n/index.js';
import { getDrivers } from '../api/drivers.js';
import { getVehicles } from '../api/vehicles.js';
import { money, escapeHtml } from '../utils/format.js';
import { routeLine, plate, statusBadge, shortDate, cargoSize } from '../utils/components.js';
import { initTripForm, openTripForm } from './trip-form.js';
import { initDellaImport, openDellaImport } from './della-import.js';
import { buildTripMessage, sendToViber, copyText } from '../utils/viber.js';
import { driveAway, flyAway } from '../utils/motion.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import { icons } from '../utils/icons.js';
import { debounce } from '../utils/debounce.js';

renderLayout();

const body = document.getElementById('tripsBody');
const search = document.getElementById('search');
const tabs = document.getElementById('statusTabs');
const drawer = document.getElementById('tripDrawer');
const card = document.getElementById('tripCard');

const TABS = [
  { status: '', label: 'Усі' },
  { status: 'in_progress', label: 'В дорозі' },
  { status: 'planned', label: 'Заплановані' },
  { status: 'done', label: 'Виконані' },
];

// В дорозі → заплановані (найближчі першими) → виконані (найсвіжіші першими)
const RANK = { in_progress: 0, planned: 1, done: 2, cancelled: 3 };
const byPriority = (a, b) =>
  RANK[a.status] - RANK[b.status] ||
  (a.status === 'done' ? b.loadDate.localeCompare(a.loadDate) : a.loadDate.localeCompare(b.loadDate));

let trips = [];
let drivers = [];
let vehicles = [];
let status = '';
let members = [];
let scope = new URLSearchParams(location.search).get('scope') === 'all' ? 'all' : 'mine';
const managerOf = (t) => members.find((m) => m.id === t.managerId);

let justCreated = new Set(); // щойно створені рейси підсвічуються в таблиці

const sourceLabel = (t) => {
  if (t.importedFrom?.platform === 'della') {
    return t.importedFrom.url
      ? `Імпортовано з <a href="${escapeHtml(t.importedFrom.url)}" target="_blank" rel="noopener">Della</a>`
      : 'Імпортовано з Della';
  }
  return t.source === 'import' ? 'Імпортовано з логістичної платформи' : 'Створено вручну';
};

const driverOf = (t) => drivers.find((d) => d.id === t.driverId);
const vehicleOf = (t) => vehicles.find((v) => v.id === t.vehicleId);
const messageFor = (t) => buildTripMessage(t, driverOf(t), vehicleOf(t));

// ---------- Список ----------
function filtered() {
  const q = search.value.trim().toLowerCase();
  return trips
    .filter((t) => scope === 'all' || t.managerId === myId())
    .filter((t) => !status || t.status === status)
    .filter((t) => {
      if (!q) return true;
      const d = driverOf(t);
      return `${t.number} ${t.from.city} ${t.to.city} ${t.cargo.type} ${t.client?.name ?? ''} ${d?.name ?? ''}`.toLowerCase().includes(q);
    })
    .sort(byPriority);
}

function renderTabs() {
  const visible = trips.filter((t) => scope === 'all' || t.managerId === myId());
  tabs.innerHTML = TABS.map((tab) => {
    const count = tab.status ? visible.filter((t) => t.status === tab.status).length : visible.length;
    return `<button class="seg__btn" type="button" data-status="${tab.status}" aria-pressed="${tab.status === status}">
      ${tab.label}<span class="seg__count">${count}</span></button>`;
  }).join('');
}

function render() {
  const list = filtered();
  const mine = trips.filter((t) => t.managerId === myId());
  document.getElementById('tripsSummary').textContent = tr('{n} ваших рейсів · {m} в дорозі зараз', {
    n: mine.length,
    m: mine.filter((x) => x.status === 'in_progress').length,
  });
  document.querySelector('.trips-table').classList.toggle('show-manager', scope === 'all');

  body.innerHTML = list.length
    ? list
        .map((t) => {
          const d = driverOf(t);
          const v = vehicleOf(t);
          return `
        <tr class="trip-tr${justCreated.has(t.id) ? ' is-fresh' : ''}" data-id="${t.id}" tabindex="0" aria-label="Рейс ${escapeHtml(t.number)}, відкрити картку">
          <td data-label="Рейс"><strong class="trip-tr__num">${escapeHtml(t.number)}</strong><span class="sub">${shortDate(t.loadDate)}</span></td>
          <td data-label="Маршрут" class="trip-tr__route">${routeLine(t)}</td>
          <td data-label="Вантаж">${escapeHtml(t.cargo.type)}<span class="sub">${cargoSize(t.cargo)}</span></td>
          <td data-label="Водій">${d ? escapeHtml(d.name) : '—'}<span class="sub">${v ? escapeHtml(v.plate) : ''}</span></td>
          <td data-label="Менеджер" class="col-manager">${t.managerId === myId() ? '<span class="sub">Ви</span>' : `<span data-no-i18n>${escapeHtml(shortName(managerOf(t)?.name ?? '—'))}</span>`}</td>
          <td data-label="Вартість" class="num trip-tr__price">${money(t.price)}</td>
          <td data-label="Статус">${statusBadge(t.status)}</td>
          <td class="trip-tr__actions">
            <a class="icon-btn" href="/pages/map.html?trip=${t.id}" title="На карті" aria-label="Рейс ${escapeHtml(t.number)} на карті">${icons.map}</a>
            <button class="icon-btn" type="button" data-viber="${t.id}" title="Надіслати водію у Viber" aria-label="Надіслати рейс ${escapeHtml(t.number)} у Viber">${icons.send}</button>
          </td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="8"><div class="empty"><p class="empty__title">Рейсів не знайдено</p><p>Змініть пошуковий запит або оберіть інший статус.</p></div></td></tr>`;
}

// ---------- Картка рейсу ----------
async function openTrip(id) {
  const t = trips.find((x) => x.id === id);
  if (!t) return;
  const d = driverOf(t);
  const v = vehicleOf(t);
  history.replaceState(null, '', `?trip=${id}`);

  card.innerHTML = `
    <header class="trip-card__head">
      <div>
        <h2 class="trip-card__title" id="drawerTitle" tabindex="-1" autofocus>${escapeHtml(t.number)}</h2>
        <p class="trip-card__meta">${sourceLabel(t)}</p>
      </div>
      ${statusBadge(t.status)}
      <button class="icon-btn trip-card__close" type="button" data-close aria-label="Закрити">${icons.close}</button>
    </header>

    <div class="trip-card__body">
      <section class="trip-card__route">
        ${routeLine(t, { size: 'lg' })}
        <div class="trip-card__addr">
          <span>${escapeHtml(t.from.address)}</span>
          <span>${escapeHtml(t.to.address)}</span>
        </div>
      </section>

      <dl class="facts">
        <div><dt>Завантаження</dt><dd>${shortDate(t.loadDate)}</dd></div>
        <div><dt>Розвантаження</dt><dd>${shortDate(t.unloadDate)}</dd></div>
        <div><dt>Вантаж</dt><dd>${escapeHtml(t.cargo.type)}<small>${cargoSize(t.cargo)}</small></dd></div>
        <div><dt>Клієнт</dt><dd>${escapeHtml(t.client?.name || '—')}${t.client?.phone ? `<small><a href="tel:${escapeHtml(t.client.phone)}">${escapeHtml(t.client.phone)}</a></small>` : ''}</dd></div>
      </dl>
      ${t.notes ? `<p class="trip-card__notes" data-no-i18n>${escapeHtml(t.notes)}</p>` : ''}

      <section class="trip-card__section">
        <h3 class="trip-card__h">Виконавці</h3>
        <div class="crew">
          <div class="crew__item">
            <span class="crew__label">Водій</span>
            <strong>${d ? escapeHtml(d.name) : '—'}</strong>
            ${d ? `<a href="tel:${d.phone}">${d.phone}</a>` : ''}
          </div>
          <div class="crew__item">
            <span class="crew__label">Авто</span>
            ${v ? plate(v.plate, { small: true }) : '—'}
            ${v ? `<span class="crew__sub">${escapeHtml(v.model)}</span>` : ''}
          </div>
        </div>
      </section>

      <section class="trip-card__section">
        <h3 class="trip-card__h">Розрахунок рейсу</h3>
        <dl class="calc" id="tripCalc"><div class="placeholder">Рахуємо…</div></dl>
      </section>
    </div>

    ${
      t.managerId !== myId()
        ? `<p class="trip-card__owner">${avatar(managerOf(t) ?? { name: '?' }, { size: 28, dot: false })}<span>${tr('Рейс веде {name}', { name: `<b data-no-i18n>${escapeHtml(managerOf(t)?.name ?? '—')}</b>` })}</span></p>`
        : ''
    }
    ${
      t.managerId === myId()
        ? `<div class="trip-card__manage">
            <button class="btn btn--ghost" type="button" data-edit="${t.id}">${icons.edit}Редагувати</button>
            <button class="btn btn--danger" type="button" data-delete="${t.id}">${icons.trash}Видалити рейс</button>
          </div>`
        : ''
    }
    <footer class="trip-card__actions">
      <a class="btn btn--ghost" href="/pages/map.html?trip=${t.id}">${icons.map}На карті</a>
      <button class="btn btn--ghost" type="button" data-copy="${t.id}">${icons.copy}Копіювати</button>
      ${t.managerId === myId() ? `<button class="btn btn--ghost" type="button" data-transfer="${t.id}">${icons.transfer}Передати колезі</button>` : ''}
      <button class="btn" type="button" data-viber="${t.id}">${icons.send}Надіслати водію</button>
    </footer>`;

  if (!drawer.open) drawer.showModal();

  try {
    const c = await calculateTrip(t.id);
    const margin = Math.round((c.profit / t.price) * 100);
    document.getElementById('tripCalc').innerHTML = `
      <div><dt>Вартість рейсу</dt><dd>${money(t.price)}</dd></div>
      <div><dt>Пальне · ${c.fuelLiters.toLocaleString(locale())} л</dt><dd>− ${money(c.fuelCost)}</dd></div>
      <div><dt>Зарплата водія</dt><dd>− ${money(c.driverSalary)}</dd></div>
      <div><dt>Дороги, стоянки, амортизація</dt><dd>− ${money(c.otherCosts)}</dd></div>
      <div class="calc__total ${c.profit < 0 ? 'is-loss' : ''}"><dt>Прибуток · ${margin} %</dt><dd>${money(c.profit)}</dd></div>`;
  } catch (err) {
    document.getElementById('tripCalc').innerHTML = `<div class="placeholder">Не вдалося розрахувати: ${escapeHtml(err.message)}</div>`;
  }
}

function closeDrawer() {
  drawer.close();
}

drawer.addEventListener('close', () => history.replaceState(null, '', location.pathname));
drawer.addEventListener('click', (e) => {
  if (e.target === drawer || e.target.closest('[data-close]')) closeDrawer();
});

// ---------- Події ----------
async function handleAction(e) {
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    drawer.close();
    openTripForm({ trip: trips.find((t) => t.id === edit.dataset.edit) });
    return true;
  }
  const del = e.target.closest('[data-delete]');
  if (del) {
    removeTrip(trips.find((t) => t.id === del.dataset.delete));
    return true;
  }
  const transfer = e.target.closest('[data-transfer]');
  if (transfer) {
    openTransfer(trips.find((t) => t.id === transfer.dataset.transfer));
    return true;
  }
  const viber = e.target.closest('[data-viber]');
  const copy = e.target.closest('[data-copy]');
  if (viber) {
    flyAway(viber);
    sendToViber(messageFor(trips.find((t) => t.id === viber.dataset.viber)));
    return true;
  }
  if (copy) {
    try {
      await copyText(messageFor(trips.find((t) => t.id === copy.dataset.copy)));
      showToast('Текст рейсу скопійовано');
    } catch {
      showToast('Не вдалося скопіювати', 'error');
    }
    return true;
  }
  return false;
}

body.addEventListener('click', async (e) => {
  if (e.target.closest('a')) return;
  if (await handleAction(e)) return;
  const row = e.target.closest('.trip-tr');
  if (row) openTrip(row.dataset.id);
});

body.addEventListener('keydown', (e) => {
  const row = e.target.closest('.trip-tr');
  if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openTrip(row.dataset.id);
  }
});

card.addEventListener('click', handleAction);

tabs.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-status]');
  if (!btn) return;
  status = btn.dataset.status;
  renderTabs();
  render();
});

search.addEventListener('input', debounce(render));

document.getElementById('scopeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-scope]');
  if (!btn) return;
  scope = btn.dataset.scope;
  document.querySelectorAll('#scopeTabs [data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  renderTabs();
  render();
});

// ---------- Передача рейсу колезі ----------
const transferDialog = document.getElementById('transferDialog');
const transferForm = document.getElementById('transferForm');
let transferring = null;

function openTransfer(trip) {
  transferring = trip;
  const colleagues = members.filter((m) => m.id !== myId());
  document.getElementById('transferText').textContent = tr('Рейс {n}: {from} → {to}', { n: trip.number, from: trip.from.city, to: trip.to.city });
  document.getElementById('transferList').innerHTML = colleagues
    .map((m) => {
      const load = trips.filter((x) => x.managerId === m.id && x.status !== 'done').length;
      return `<li><label>
        <input type="radio" name="toManager" value="${m.id}" />
        ${avatar(m, { size: 34 })}
        <span><strong data-no-i18n>${escapeHtml(m.name)}</strong><small>${escapeHtml(m.position)} · ${tr('активних рейсів: {n}', { n: load })}</small></span>
      </label></li>`;
    })
    .join('');
  document.getElementById('transferComment').value = '';
  transferForm.querySelector('.field').classList.remove('field--error');
  transferForm.querySelector('.field__error').textContent = '';
  transferDialog.showModal();
}

document.getElementById('transferCancel').addEventListener('click', () => transferDialog.close());

transferForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const to = transferForm.elements.toManager?.value;
  if (!to) {
    transferForm.querySelector('.field').classList.add('field--error');
    transferForm.querySelector('.field__error').textContent = 'Оберіть колегу, якому передаєте рейс';
    return;
  }
  const btn = transferForm.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    const updated = await transferTrip(transferring.id, to, document.getElementById('transferComment').value.trim());
    transferDialog.close();
    drawer.close();
    // рейс «від'їжджає» з таблиці до колеги
    if (scope === 'mine') await driveAway(document.querySelector(`.trip-tr[data-id="${updated.id}"]`));
    trips = trips.map((x) => (x.id === updated.id ? updated : x));
    renderTabs();
    render();
    showToast(tr('Рейс {n} передано: {name}', { n: updated.number, name: shortName(members.find((m) => m.id === to)?.name) }));
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function init() {
  [trips, drivers, vehicles, members] = await Promise.all([getTrips(), getDrivers(), getVehicles(), getMembers()]);
  document.querySelectorAll('#scopeTabs [data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  renderTabs();
  render();
  const fromUrl = new URLSearchParams(location.search).get('trip');
  if (fromUrl) openTrip(fromUrl);

  initTripForm({ getTrips: () => trips, drivers, vehicles, onCreated: showCreated, onUpdated: showUpdated });
  initDellaImport({ getTrips: () => trips, onCreated: showCreated });
}

async function removeTrip(t) {
  const ok = await confirmDialog({
    title: tr('Видалити рейс {n}?', { n: t.number }),
    text:
      t.status === 'in_progress'
        ? 'Рейс зараз виконується. Якщо його скасували, краще змінити статус на «Скасовано» — тоді він залишиться в історії.'
        : 'Рейс зникне зі списку й аналітики. Дію не можна скасувати.',
  });
  if (!ok) return;
  try {
    await deleteTrip(t.id);
    trips = trips.filter((x) => x.id !== t.id);
    drawer.close();
    renderTabs();
    render();
    showToast(tr('Рейс {n} видалено', { n: t.number }));
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showUpdated(trip) {
  trips = trips.map((x) => (x.id === trip.id ? trip : x));
  justCreated = new Set([trip.id]);
  renderTabs();
  render();
  showToast(tr('Рейс {n} оновлено', { n: trip.number }));
}

// Нові рейси (один з форми або кілька з Della) — у таблицю й підсвітити
function showCreated(created) {
  const list = [created].flat();
  trips = [...trips, ...list];
  justCreated = new Set(list.map((t) => t.id));
  // нові рейси мають бути видно: «Мої», усі статуси, без пошуку
  status = '';
  search.value = '';
  renderTabs();
  render();
  document.querySelector(`.trip-tr[data-id="${list[0].id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  showToast(
    list.length === 1 ? tr('Рейс {n} створено', { n: list[0].number }) : tr('Додано рейсів з Della: {n}', { n: list.length })
  );
}

document.getElementById('newTripBtn').addEventListener('click', () => openTripForm());
document.getElementById('importDellaBtn').addEventListener('click', openDellaImport);

init();

// Рейси: список (фільтри, сортування, сторінки, експорт) і картка рейсу в бічній панелі
// (оплата, документи, історія змін, друк заявки)
import { renderLayout } from '../utils/layout.js';
import { getTrips, calculateTrip, transferTrip, deleteTrip, setTripPayment, myId, canEditTrip } from '../api/trips.js';
import { getClients } from '../api/clients.js';
import { getDocumentsSummary, TRIP_DOC_TYPES } from '../api/documents.js';
import { openDocuments } from './documents.js';
import { printTripRequest } from '../utils/print-request.js';
import { downloadCsv } from '../utils/csv.js';
import { getMembers } from '../api/company.js';
import { shortName, avatar } from '../utils/people.js';
import { t as tr, locale } from '../i18n/index.js';
import { getDrivers } from '../api/drivers.js';
import { getVehicles } from '../api/vehicles.js';
import { money, escapeHtml, PAYMENT_STATUS, TRIP_STATUS, paymentStatus, daysPastDue } from '../utils/format.js';
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
  { status: 'cancelled', label: 'Скасовані' },
];
const PAGE_SIZE = 20;

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
let clients = [];
let docCounts = {};
let scope = new URLSearchParams(location.search).get('scope') === 'all' ? 'all' : 'mine';
let sort = { key: 'priority', dir: 1 };
let page = 1;
const managerOf = (t) => members.find((m) => m.id === t.managerId);
const memberName = (id) => (id === myId() ? tr('Ви') : shortName(members.find((m) => m.id === id)?.name ?? '—'));

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
const dateFrom = document.getElementById('dateFrom');
const dateTo = document.getElementById('dateTo');
const payFilter = document.getElementById('payFilter');

const PAY_RANK = { overdue: 0, pending: 1, paid: 2 };
const SORTS = {
  priority: byPriority,
  date: (a, b) => a.loadDate.localeCompare(b.loadDate) || a.number.localeCompare(b.number),
  price: (a, b) => a.price - b.price,
  status: (a, b) => RANK[a.status] - RANK[b.status],
  payment: (a, b) => (PAY_RANK[paymentStatus(a)] ?? 3) - (PAY_RANK[paymentStatus(b)] ?? 3) || (a.payment?.dueDate ?? '').localeCompare(b.payment?.dueDate ?? ''),
};

function filtered() {
  const q = search.value.trim().toLowerCase();
  const pay = payFilter.value;
  return trips
    .filter((t) => scope === 'all' || t.managerId === myId())
    .filter((t) => !status || t.status === status)
    .filter((t) => (!dateFrom.value || t.loadDate >= dateFrom.value) && (!dateTo.value || t.loadDate <= dateTo.value))
    .filter((t) => {
      if (!pay) return true;
      const p = paymentStatus(t);
      return pay === 'unpaid' ? p === 'pending' || p === 'overdue' : p === pay;
    })
    .filter((t) => {
      if (!q) return true;
      const d = driverOf(t);
      return `${t.number} ${t.from.city} ${t.to.city} ${t.cargo.type} ${t.client?.name ?? ''} ${d?.name ?? ''}`.toLowerCase().includes(q);
    })
    .sort((a, b) => SORTS[sort.key](a, b) * sort.dir);
}

// Рядок під статусом рейсу: «Очікує оплати · до 10 груд.», «Прострочено · 12 дн.»
function paymentLine(t) {
  const p = paymentStatus(t);
  if (!p) return '';
  const note =
    p === 'paid'
      ? shortDate(t.payment.paidAt)
      : p === 'overdue'
        ? tr('{n} дн.', { n: daysPastDue(t) })
        : tr('до {date}', { date: shortDate(t.payment.dueDate) });
  return `<span class="pay-line pay-line--${p}">${tr(PAYMENT_STATUS[p])} · ${note}</span>`;
}

function renderTabs() {
  const visible = trips.filter((t) => scope === 'all' || t.managerId === myId());
  tabs.innerHTML = TABS.map((tab) => {
    const count = tab.status ? visible.filter((t) => t.status === tab.status).length : visible.length;
    return `<button class="seg__btn" type="button" data-status="${tab.status}" aria-pressed="${tab.status === status}">
      ${tab.label}<span class="seg__count">${count}</span></button>`;
  }).join('');
}

function renderSortHeaders() {
  document.querySelectorAll('#tripsHead th[aria-sort]').forEach((th) => {
    const keys = [...th.querySelectorAll('[data-sort]')].map((b) => b.dataset.sort);
    th.setAttribute('aria-sort', keys.includes(sort.key) ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');
    th.querySelectorAll('[data-sort]').forEach((b) => b.classList.toggle('is-active', b.dataset.sort === sort.key));
  });
}

function renderPager(total) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(page, pages);
  const from = total ? (page - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(page * PAGE_SIZE, total);
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  document.getElementById('pager').innerHTML =
    total > PAGE_SIZE
      ? `<p class="pager__info">${tr('{from}–{to} з {total}', { from, to, total })}</p>
         <div class="pager__pages">
           <button class="icon-btn" type="button" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''} aria-label="Попередня сторінка">‹</button>
           ${nums
             .map((n) =>
               n === '…'
                 ? '<span class="pager__gap">…</span>'
                 : `<button class="pager__num" type="button" data-page="${n}" ${n === page ? 'aria-current="page"' : ''}>${n}</button>`
             )
             .join('')}
           <button class="icon-btn" type="button" data-page="${page + 1}" ${page === pages ? 'disabled' : ''} aria-label="Наступна сторінка">›</button>
         </div>`
      : total
        ? `<p class="pager__info">${tr('Усього: {n}', { n: total })}</p>`
        : '';
}

function render() {
  const all = filtered();
  renderSortHeaders();
  renderPager(all.length);
  const list = all.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  document.getElementById('filtersReset').hidden = !(dateFrom.value || dateTo.value || payFilter.value);
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
          <td data-label="Статус" class="trip-tr__state">${statusBadge(t.status)}${paymentLine(t)}</td>
          <td class="trip-tr__actions">
            <a class="icon-btn" href="/pages/map.html?trip=${t.id}" title="На карті" aria-label="Рейс ${escapeHtml(t.number)} на карті">${icons.map}</a>
            <button class="icon-btn" type="button" data-viber="${t.id}" title="Надіслати водію у Viber" aria-label="Надіслати рейс ${escapeHtml(t.number)} у Viber">${icons.send}</button>
          </td>
        </tr>`;
        })
        .join('')
    : `<tr><td colspan="8"><div class="empty"><p class="empty__title">Рейсів не знайдено</p><p>Змініть пошуковий запит або оберіть інший статус.</p></div></td></tr>`;
}

// ---------- Історія змін ----------
const FIELD_LABELS = {
  price: 'Вартість',
  loadDate: 'Дата завантаження',
  unloadDate: 'Дата розвантаження',
  driverId: 'Водій',
  vehicleId: 'Авто',
  distanceKm: 'Відстань',
  route: 'Маршрут',
};

function fieldValue(field, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'price') return money(value);
  if (field === 'distanceKm') return `${value} км`;
  if (field === 'loadDate' || field === 'unloadDate') return shortDate(value);
  if (field === 'driverId') return drivers.find((d) => d.id === value)?.name ?? '—';
  if (field === 'vehicleId') return vehicles.find((v) => v.id === value)?.plate ?? '—';
  return value;
}

function historyText(h) {
  switch (h.action) {
    case 'created':
      return tr('Створено рейс');
    case 'imported':
      return tr('Імпортовано з Della');
    case 'status':
      return tr('Статус: {status}', { status: tr(TRIP_STATUS[h.to] ?? h.to) });
    case 'paid':
      return tr('Позначено оплату');
    case 'unpaid':
      return tr('Знято позначку оплати');
    case 'transferred':
      return tr('Передано: {from} → {to}', { from: memberName(h.from), to: memberName(h.to) });
    case 'updated':
      return h.changes
        .map((c) => `${tr(FIELD_LABELS[c.field] ?? c.field)}: ${escapeHtml(fieldValue(c.field, c.from))} → ${escapeHtml(fieldValue(c.field, c.to))}`)
        .join('<br>');
    default:
      return escapeHtml(h.action);
  }
}

function renderHistory(t) {
  const items = [...(t.history ?? [])].reverse();
  if (!items.length) return '<p class="sub">Змін ще не було</p>';
  return `<ol class="timeline">${items
    .map(
      (h) => `<li class="timeline__item timeline__item--${h.action}">
        <p class="timeline__text">${historyText(h)}</p>
        <p class="timeline__meta"><span data-no-i18n>${escapeHtml(memberName(h.by))}</span> · ${new Date(h.at).toLocaleString(locale(), {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}</p>
      </li>`
    )
    .join('')}</ol>`;
}

// ---------- Оплата в картці ----------
function renderPayment(t) {
  const p = paymentStatus(t);
  if (!p) return `<p class="sub">${t.status === 'cancelled' ? 'Рейс скасовано — оплата не потрібна' : 'Термін оплати не вказано'}</p>`;
  const lines = [
    t.payment.dueDate && `<div><dt>Термін оплати</dt><dd>${shortDate(t.payment.dueDate)}</dd></div>`,
    t.payment.paidAt && `<div><dt>Оплачено</dt><dd>${shortDate(t.payment.paidAt)}</dd></div>`,
    p === 'overdue' && `<div><dt>Прострочено</dt><dd class="is-bad">${tr('{n} дн.', { n: daysPastDue(t) })}</dd></div>`,
  ].filter(Boolean);
  return `
    <div class="pay-box pay-box--${p}">
      ${statusBadge(p, PAYMENT_STATUS)}
      <dl class="pay-box__facts">${lines.join('')}</dl>
      ${
        canEditTrip(t)
          ? p === 'paid'
            ? `<button class="btn btn--text" type="button" data-unpay="${t.id}">Скасувати позначку</button>`
            : `<button class="btn btn--ghost" type="button" data-pay="${t.id}">${icons.check ?? ''}Позначити оплаченим</button>`
          : ''
      }
    </div>`;
}

// ---------- Картка рейсу ----------
async function openTrip(id) {
  const t = trips.find((x) => x.id === id);
  if (!t) return;
  const d = driverOf(t);
  const v = vehicleOf(t);
  const editable = canEditTrip(t);
  const docs = docCounts[t.id]?.count ?? 0;
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
        <h3 class="trip-card__h">Оплата</h3>
        ${renderPayment(t)}
      </section>

      <section class="trip-card__section">
        <h3 class="trip-card__h">Розрахунок рейсу</h3>
        <dl class="calc" id="tripCalc"><div class="placeholder">Рахуємо…</div></dl>
      </section>

      <section class="trip-card__section">
        <div class="trip-card__row">
          <h3 class="trip-card__h">Документи рейсу</h3>
          <button class="btn btn--ghost btn--sm" type="button" data-docs="${t.id}">${icons.doc}${docs ? tr('Відкрити ({n})', { n: docs }) : 'Додати'}</button>
        </div>
        <p class="sub">ТТН, CMR, акти, рахунок, фото завантаження й розвантаження</p>
      </section>

      <details class="trip-card__section trip-card__history">
        <summary class="trip-card__h">${tr('Історія змін ({n})', { n: (t.history ?? []).length })}</summary>
        ${renderHistory(t)}
      </details>
    </div>

    ${
      t.managerId !== myId()
        ? `<p class="trip-card__owner">${avatar(managerOf(t) ?? { name: '?' }, { size: 28, dot: false })}<span>${tr('Рейс веде {name}', { name: `<b data-no-i18n>${escapeHtml(managerOf(t)?.name ?? '—')}</b>` })}</span></p>`
        : ''
    }
    ${
      editable
        ? `<div class="trip-card__manage">
            <button class="btn btn--ghost" type="button" data-edit="${t.id}">${icons.edit}Редагувати</button>
            <button class="btn btn--danger" type="button" data-delete="${t.id}">${icons.trash}Видалити рейс</button>
          </div>`
        : ''
    }
    <footer class="trip-card__actions">
      <a class="btn btn--ghost" href="/pages/map.html?trip=${t.id}">${icons.map}На карті</a>
      <button class="btn btn--ghost" type="button" data-print="${t.id}">${icons.print ?? ''}Заявка (друк)</button>
      <button class="btn btn--ghost" type="button" data-copy="${t.id}">${icons.copy}Копіювати</button>
      ${editable ? `<button class="btn btn--ghost" type="button" data-transfer="${t.id}">${icons.transfer}Передати колезі</button>` : ''}
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
  const pay = e.target.closest('[data-pay],[data-unpay]');
  if (pay) {
    const id = pay.dataset.pay ?? pay.dataset.unpay;
    const paidAt = pay.dataset.pay ? new Date().toISOString().slice(0, 10) : null;
    try {
      const updated = await setTripPayment(id, { paidAt });
      trips = trips.map((x) => (x.id === id ? updated : x));
      render();
      openTrip(id);
      showToast(paidAt ? tr('Рейс {n}: оплату отримано', { n: updated.number }) : tr('Рейс {n}: позначку оплати знято', { n: updated.number }));
    } catch (err) {
      showToast(err.message, 'error');
    }
    return true;
  }
  const docsBtn = e.target.closest('[data-docs]');
  if (docsBtn) {
    const t = trips.find((x) => x.id === docsBtn.dataset.docs);
    openDocuments({
      ownerType: 'trips',
      ownerId: t.id,
      title: 'Документи рейсу',
      owner: `${t.number} · ${t.from.city} → ${t.to.city}`,
      types: TRIP_DOC_TYPES,
      onChange: async () => {
        docCounts = await getDocumentsSummary('trips').catch(() => docCounts);
      },
    });
    return true;
  }
  const print = e.target.closest('[data-print]');
  if (print) {
    const t = trips.find((x) => x.id === print.dataset.print);
    printTripRequest(t, { driver: driverOf(t), vehicle: vehicleOf(t), client: clients.find((c) => c.id === t.clientId), manager: managerOf(t) });
    return true;
  }
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
  page = 1;
  renderTabs();
  render();
});

const refilter = () => {
  page = 1;
  render();
};
search.addEventListener('input', debounce(refilter));
[dateFrom, dateTo, payFilter].forEach((el) => el.addEventListener('change', refilter));
document.getElementById('filtersReset').addEventListener('click', () => {
  dateFrom.value = dateTo.value = payFilter.value = '';
  refilter();
});

// Сортування: клік по заголовку — за зростанням, ще раз — за спаданням, втретє — як було
document.getElementById('tripsHead').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-sort]');
  if (!btn) return;
  const key = btn.dataset.sort;
  if (sort.key !== key) sort = { key, dir: key === 'date' || key === 'price' ? -1 : 1 };
  else if (sort.dir === (key === 'date' || key === 'price' ? -1 : 1)) sort.dir *= -1;
  else sort = { key: 'priority', dir: 1 };
  page = 1;
  render();
});

document.getElementById('pager').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-page]');
  if (!btn || btn.disabled) return;
  page = Number(btn.dataset.page);
  render();
  document.querySelector('.trips-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// Експорт поточного списку (з усіма фільтрами, усі сторінки) — CSV, відкривається в Excel
document.getElementById('exportBtn').addEventListener('click', () => {
  const list = filtered();
  if (!list.length) return showToast('Немає рейсів для експорту', 'error');
  const columns = [
    ['Рейс', (t) => t.number],
    ['Завантаження', (t) => t.loadDate],
    ['Розвантаження', (t) => t.unloadDate ?? ''],
    ['Звідки', (t) => t.from.city],
    ['Куди', (t) => t.to.city],
    ['Відстань, км', (t) => t.distanceKm],
    ['Вантаж', (t) => t.cargo.type],
    ['Вага, т', (t) => t.cargo.weightT],
    ['Клієнт', (t) => t.client?.name ?? ''],
    ['ЄДРПОУ', (t) => clients.find((c) => c.id === t.clientId)?.edrpou ?? ''],
    ['Водій', (t) => driverOf(t)?.name ?? ''],
    ['Авто', (t) => vehicleOf(t)?.plate ?? ''],
    ['Менеджер', (t) => managerOf(t)?.name ?? ''],
    ['Вартість, грн', (t) => t.price],
    ['Статус', (t) => tr(TRIP_STATUS[t.status])],
    ['Оплата', (t) => (paymentStatus(t) ? tr(PAYMENT_STATUS[paymentStatus(t)]) : '')],
    ['Термін оплати', (t) => t.payment?.dueDate ?? ''],
    ['Дата оплати', (t) => t.payment?.paidAt ?? ''],
  ];
  downloadCsv(`reisy-${new Date().toISOString().slice(0, 10)}.csv`, [columns.map(([h]) => tr(h)), ...list.map((t) => columns.map(([, fn]) => fn(t)))]);
  showToast(tr('Експортовано рейсів: {n}', { n: list.length }));
});

document.getElementById('scopeTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-scope]');
  if (!btn) return;
  scope = btn.dataset.scope;
  page = 1;
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
  [trips, drivers, vehicles, members, clients, docCounts] = await Promise.all([
    getTrips(),
    getDrivers(),
    getVehicles(),
    getMembers(),
    getClients(),
    getDocumentsSummary('trips').catch(() => ({})),
  ]);
  // фільтр з посилання: ?pay=overdue (з нагадувань і сторінки клієнтів)
  const params = new URLSearchParams(location.search);
  if (params.get('pay')) payFilter.value = params.get('pay');
  if (params.get('client')) search.value = clients.find((c) => c.id === params.get('client'))?.name ?? '';
  if ((params.get('pay') || params.get('client')) && !params.get('scope')) scope = 'all';
  document.querySelectorAll('#scopeTabs [data-scope]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scope === scope)));
  renderTabs();
  render();
  const fromUrl = new URLSearchParams(location.search).get('trip');
  if (fromUrl) openTrip(fromUrl);

  initTripForm({ getTrips: () => trips, drivers, vehicles, clients, onCreated: showCreated, onUpdated: showUpdated });
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

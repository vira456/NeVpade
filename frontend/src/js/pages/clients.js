// Клієнти: довідник замовників з боргами, історією рейсів і контактами
import { renderLayout } from '../utils/layout.js';
import { getClients, createClient, updateClient, deleteClient } from '../api/clients.js';
import { getTrips, isOwner } from '../api/trips.js';
import { money, escapeHtml, paymentStatus, PAYMENT_STATUS, TRIP_STATUS, daysPastDue, plural } from '../utils/format.js';
import { routeLine, statusBadge, shortDate } from '../utils/components.js';
import { icons } from '../utils/icons.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import { downloadCsv } from '../utils/csv.js';
import { debounce } from '../utils/debounce.js';
import { setFieldError, clearErrors, showAlert, withLoading, isEmail, phoneDigits, phoneError, toE164 } from '../utils/validation.js';
import { t } from '../i18n/index.js';

renderLayout();

const $ = (id) => document.getElementById(id);
const body = $('clientsBody');
const drawer = $('clientDrawer');
const dialog = $('clientDialog');
const form = $('clientForm');

let clients = [];
let trips = [];
let filter = ['debt', 'overdue'].includes(new URLSearchParams(location.search).get('filter')) ? new URLSearchParams(location.search).get('filter') : '';
let editing = null;

// ---------- Підсумки по клієнту ----------
function statsOf(client) {
  const list = trips.filter((tr) => tr.clientId === client.id && tr.status !== 'cancelled');
  const counted = list.filter((tr) => ['done', 'in_progress'].includes(tr.status));
  const unpaid = list.filter((tr) => ['pending', 'overdue'].includes(paymentStatus(tr)) && tr.status !== 'planned');
  const overdue = unpaid.filter((tr) => paymentStatus(tr) === 'overdue');
  const last = [...list].sort((a, b) => b.loadDate.localeCompare(a.loadDate))[0];
  return {
    trips: list,
    count: counted.length,
    revenue: counted.reduce((s, tr) => s + tr.price, 0),
    debt: unpaid.reduce((s, tr) => s + tr.price, 0),
    overdueSum: overdue.reduce((s, tr) => s + tr.price, 0),
    overdueCount: overdue.length,
    last,
  };
}

function filtered() {
  const q = $('clientSearch').value.trim().toLowerCase();
  return clients
    .map((c) => ({ c, s: statsOf(c) }))
    .filter(({ s }) => (filter === 'debt' ? s.debt > 0 : filter === 'overdue' ? s.overdueSum > 0 : true))
    .filter(({ c }) => !q || `${c.name} ${c.edrpou} ${c.contactName} ${c.city} ${c.phone}`.toLowerCase().includes(q))
    .sort((a, b) => b.s.overdueSum - a.s.overdueSum || b.s.revenue - a.s.revenue);
}

function render() {
  const all = clients.map((c) => statsOf(c));
  const debt = all.reduce((s, x) => s + x.debt, 0);
  const overdue = all.reduce((s, x) => s + x.overdueSum, 0);
  $('clientsSummary').innerHTML = [
    t(plural(clients.length, ['{n} клієнт', '{n} клієнти', '{n} клієнтів']), { n: clients.length }),
    t('чекаємо оплату: {sum}', { sum: money(debt) }),
    overdue ? `<span class="is-bad">${t('прострочено: {sum}', { sum: money(overdue) })}</span>` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const list = filtered();
  body.innerHTML = list.length
    ? list
        .map(
          ({ c, s }) => `
      <tr class="trip-tr" data-id="${c.id}" tabindex="0" aria-label="${escapeHtml(t('Клієнт {name}, відкрити картку', { name: c.name }))}">
        <td data-label="${t('Клієнт')}"><strong data-no-i18n>${escapeHtml(c.name)}</strong><span class="sub">${c.edrpou ? `${t('ЄДРПОУ')} ${escapeHtml(c.edrpou)}` : ''}${c.city ? `${c.edrpou ? ' · ' : ''}<span data-no-i18n>${escapeHtml(c.city)}</span>` : ''}</span></td>
        <td data-label="${t('Контакт')}"><span data-no-i18n>${escapeHtml(c.contactName || '—')}</span>${c.phone ? `<span class="sub">${escapeHtml(c.phone)}</span>` : ''}</td>
        <td data-label="${t('Рейсів')}" class="num">${s.count}</td>
        <td data-label="${t('Виручка')}" class="num">${money(s.revenue)}</td>
        <td data-label="${t('Борг')}" class="num">${
          s.debt
            ? `<strong class="${s.overdueSum ? 'is-bad' : ''}">${money(s.debt)}</strong>${s.overdueSum ? `<span class="sub is-bad">${t('прострочено {n}', { n: s.overdueCount })}</span>` : ''}`
            : '<span class="sub">—</span>'
        }</td>
        <td data-label="${t('Останній рейс')}">${s.last ? `${shortDate(s.last.loadDate)}<span class="sub">${escapeHtml(s.last.number)}</span>` : '<span class="sub">—</span>'}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="6"><div class="empty"><p class="empty__title">${clients.length ? 'Клієнтів не знайдено' : 'Клієнтів ще немає'}</p>${
        clients.length ? '<p>Змініть пошук або фільтр.</p>' : '<button class="btn" type="button" data-add>Додати клієнта</button>'
      }</div></td></tr>`;
}

// ---------- Картка клієнта ----------
function openClient(id) {
  const c = clients.find((x) => x.id === id);
  if (!c) return;
  const s = statsOf(c);
  const unpaid = s.trips.filter((tr) => ['pending', 'overdue'].includes(paymentStatus(tr)) && tr.status !== 'planned');
  const recent = [...s.trips].sort((a, b) => b.loadDate.localeCompare(a.loadDate)).slice(0, 8);
  history.replaceState(null, '', `?client=${id}`);

  $('clientCard').innerHTML = `
    <header class="trip-card__head">
      <div>
        <h2 class="trip-card__title" id="clientTitle" data-no-i18n>${escapeHtml(c.name)}</h2>
        <p class="trip-card__meta">${[c.edrpou && `${t('ЄДРПОУ')} ${escapeHtml(c.edrpou)}`, c.city && `<span data-no-i18n>${escapeHtml(c.city)}</span>`].filter(Boolean).join(' · ') || '&nbsp;'}</p>
      </div>
      <button class="icon-btn trip-card__close" type="button" data-close aria-label="Закрити">${icons.close}</button>
    </header>

    <div class="trip-card__body">
      <dl class="facts">
        <div><dt>Рейсів</dt><dd>${s.count}</dd></div>
        <div><dt>Виручка</dt><dd>${money(s.revenue)}</dd></div>
        <div><dt>Середній рейс</dt><dd>${s.count ? money(Math.round(s.revenue / s.count)) : '—'}</dd></div>
        <div><dt>Відстрочка</dt><dd>${t('{n} дн.', { n: c.paymentDays ?? 14 })}</dd></div>
      </dl>

      <section class="trip-card__section">
        <h3 class="trip-card__h">Контакти</h3>
        <div class="crew">
          <div class="crew__item"><span class="crew__label">Контактна особа</span><strong data-no-i18n>${escapeHtml(c.contactName || '—')}</strong>${c.phone ? `<a href="tel:${escapeHtml(c.phone)}">${escapeHtml(c.phone)}</a>` : ''}</div>
          <div class="crew__item"><span class="crew__label">Email</span>${c.email ? `<a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a>` : '—'}</div>
        </div>
        ${c.notes ? `<p class="trip-card__notes" data-no-i18n>${escapeHtml(c.notes)}</p>` : ''}
      </section>

      <section class="trip-card__section">
        <div class="trip-card__row">
          <h3 class="trip-card__h">${t('Неоплачені рейси ({n})', { n: unpaid.length })}</h3>
          ${unpaid.length ? `<a class="btn btn--text btn--sm" href="/pages/trips.html?client=${c.id}&pay=unpaid">У рейсах</a>` : ''}
        </div>
        ${
          unpaid.length
            ? `<ul class="mini-trips">${unpaid
                .map((tr) => {
                  const p = paymentStatus(tr);
                  return `<li><a href="/pages/trips.html?trip=${tr.id}"><strong>${escapeHtml(tr.number)}</strong> <span data-no-i18n>${escapeHtml(tr.from.city)} → ${escapeHtml(tr.to.city)}</span></a>
                    <span class="mini-trips__sum">${money(tr.price)}</span>
                    <span class="pay-line pay-line--${p}">${t(PAYMENT_STATUS[p])} · ${p === 'overdue' ? t('{n} дн.', { n: daysPastDue(tr) }) : t('до {date}', { date: shortDate(tr.payment.dueDate) })}</span></li>`;
                })
                .join('')}</ul>`
            : '<p class="sub">Боргів немає</p>'
        }
      </section>

      <section class="trip-card__section">
        <h3 class="trip-card__h">Останні рейси</h3>
        ${
          recent.length
            ? `<ul class="mini-trips">${recent
                .map(
                  (tr) => `<li><a href="/pages/trips.html?trip=${tr.id}"><strong>${escapeHtml(tr.number)}</strong> ${shortDate(tr.loadDate)}</a>
                    ${routeLine(tr)}
                    <span>${statusBadge(tr.status, TRIP_STATUS)}</span></li>`
                )
                .join('')}</ul>`
            : '<p class="sub">Рейсів ще не було</p>'
        }
      </section>
    </div>

    <div class="trip-card__manage">
      <button class="btn btn--ghost" type="button" data-edit="${c.id}">${icons.edit}Редагувати</button>
      ${isOwner() ? `<button class="btn btn--danger" type="button" data-delete="${c.id}">${icons.trash}Видалити</button>` : ''}
    </div>
    <footer class="trip-card__actions">
      ${c.phone ? `<a class="btn btn--ghost" href="tel:${escapeHtml(c.phone)}">${icons.phone}Подзвонити</a>` : ''}
      <a class="btn" href="/pages/trips.html?client=${c.id}">${icons.trips}Усі рейси клієнта</a>
    </footer>`;
  if (!drawer.open) drawer.showModal();
}

drawer.addEventListener('close', () => history.replaceState(null, '', location.pathname));
drawer.addEventListener('click', async (e) => {
  if (e.target === drawer || e.target.closest('[data-close]')) return drawer.close();
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    drawer.close();
    return openForm(clients.find((c) => c.id === edit.dataset.edit));
  }
  const del = e.target.closest('[data-delete]');
  if (del) {
    const c = clients.find((x) => x.id === del.dataset.delete);
    if (!(await confirmDialog({ title: t('Видалити клієнта {name}?', { name: c.name }), text: 'Клієнта буде прибрано з довідника.' }))) return;
    try {
      await deleteClient(c.id);
      clients = clients.filter((x) => x.id !== c.id);
      drawer.close();
      render();
      showToast(t('Клієнта {name} видалено', { name: c.name }));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
});

// ---------- Форма ----------
function openForm(client = null) {
  editing = client;
  form.reset();
  clearErrors(form);
  $('clientFormTitle').textContent = client ? 'Дані клієнта' : 'Новий клієнт';
  $('cfName').value = client?.name ?? '';
  $('cfEdrpou').value = client?.edrpou ?? '';
  $('cfCity').value = client?.city ?? '';
  $('cfContact').value = client?.contactName ?? '';
  $('cfPhone').value = client?.phone ?? '';
  $('cfEmail').value = client?.email ?? '';
  $('cfDays').value = client?.paymentDays ?? 14;
  $('cfNotes').value = client?.notes ?? '';
  dialog.showModal();
  $('cfName').focus();
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  const v = (id) => $(id).value.trim();
  const edrpou = v('cfEdrpou').replace(/\s/g, '');
  const days = Number(v('cfDays'));
  const errors = [
    ['cfName', v('cfName').length < 2 && 'Вкажіть назву клієнта'],
    ['cfEdrpou', edrpou && !/^(\d{8}|\d{10})$/.test(edrpou) && 'ЄДРПОУ — 8 цифр, ІПН ФОП — 10 цифр'],
    ['cfPhone', v('cfPhone') && phoneError(v('cfPhone'))],
    ['cfEmail', v('cfEmail') && !isEmail(v('cfEmail')) && 'Введіть коректний email'],
    ['cfDays', (v('cfDays') === '' || days < 0 || days > 120 || !Number.isInteger(days)) && 'Від 0 до 120 днів'],
  ].filter(([, msg]) => msg);
  errors.forEach(([id, msg]) => setFieldError($(id), msg));
  if (errors.length) return $(errors[0][0]).focus();

  const data = {
    name: v('cfName'),
    edrpou,
    city: v('cfCity'),
    contactName: v('cfContact'),
    phone: v('cfPhone') ? toE164(phoneDigits(v('cfPhone'))) : '',
    email: v('cfEmail'),
    paymentDays: days,
    notes: v('cfNotes'),
  };
  const wasEditing = Boolean(editing);
  try {
    const saved = await withLoading(form.querySelector('[type=submit]'), () => (wasEditing ? updateClient(editing.id, data) : createClient(data)));
    clients = wasEditing ? clients.map((c) => (c.id === saved.id ? saved : c)) : [...clients, saved];
    if (wasEditing) trips = await getTrips(); // назва клієнта в рейсах теж оновилась
    dialog.close();
    render();
    showToast(wasEditing ? 'Зміни збережено' : t('Клієнта {name} додано', { name: saved.name }));
  } catch (err) {
    if (err.code === 'edrpou_taken') setFieldError($('cfEdrpou'), err.message);
    else showAlert(form, err.message);
  }
});

dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-cancel]')) dialog.close();
});

// ---------- Події списку ----------
body.addEventListener('click', (e) => {
  if (e.target.closest('[data-add]')) return openForm();
  const row = e.target.closest('.trip-tr');
  if (row) openClient(row.dataset.id);
});
body.addEventListener('keydown', (e) => {
  const row = e.target.closest('.trip-tr');
  if (row && e.target === row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    openClient(row.dataset.id);
  }
});
$('addClient').addEventListener('click', () => openForm());
$('clientSearch').addEventListener('input', debounce(render));
$('debtTabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-filter]');
  if (!btn) return;
  filter = btn.dataset.filter;
  document.querySelectorAll('#debtTabs [data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
  render();
});

$('exportClients').addEventListener('click', () => {
  const rows = filtered().map(({ c, s }) => [c.name, c.edrpou, c.city, c.contactName, c.phone, c.email, c.paymentDays, s.count, s.revenue, s.debt, s.overdueSum]);
  const head = ['Назва', 'ЄДРПОУ', 'Місто', 'Контактна особа', 'Телефон', 'Email', 'Відстрочка, днів', 'Рейсів', 'Виручка, грн', 'Борг, грн', 'Прострочено, грн'].map((h) => t(h));
  downloadCsv(`kliienty-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows]);
});

async function init() {
  [clients, trips] = await Promise.all([getClients(), getTrips()]);
  document.querySelectorAll('#debtTabs [data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  render();
  const fromUrl = new URLSearchParams(location.search).get('client');
  if (fromUrl) openClient(fromUrl);
}

init();

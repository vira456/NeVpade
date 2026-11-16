// «Вантажі з Della»: сайт сам завантажує сторінку пошуку на della.ua, розбирає картки вантажів
// (парсинг HTML) і показує список. Менеджер відмічає потрібні — і вони одразу стають рейсами.
import { fetchDellaPage, dellaPath } from '../api/della.js';
import { createTrip } from '../api/trips.js';
import { parseDellaSearchPage, dellaToTrip, sameCargo } from '../utils/della.js';
import { money, escapeHtml } from '../utils/format.js';
import { shortDate, cargoSize } from '../utils/components.js';
import { load, save } from '../utils/storage.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';
import { t as tr, locale } from '../i18n/index.js';
import { openTripForm } from './trip-form.js';

const DEFAULT_URL = 'https://della.ua/search/a204bd204eflolh0ilk0m1.html'; // Україна — Україна
const $ = (id) => document.getElementById(id);
const dialog = $('dellaDialog');
const urlInput = $('dellaUrl');
const items = $('dellaItems');
const addBtn = $('dellaAdd');

let ctx = { getTrips: () => [], onCreated: () => {} };
let listings = []; // відкриті вантажі з усіх завантажених сторінок
let closedCount = 0;
let nextPageUrl = '';

export function initDellaImport(options) {
  ctx = { ...ctx, ...options };
}

export function openDellaImport() {
  urlInput.value = load('della.url') ?? DEFAULT_URL;
  clearErrors(dialog);
  if (!dialog.open) dialog.showModal();
  if (!listings.length) loadPage(urlInput.value);
  else render();
}

// ---------- Завантаження й парсинг ----------
async function loadPage(url, { append = false, force = false } = {}) {
  const alertEl = $('dellaAlert');
  alertEl.hidden = true;
  if (!append) items.innerHTML = '<li class="della-list__empty">Завантажуємо вантажі з Della…</li>';
  try {
    const { html, at } = await fetchDellaPage(url, { force });
    const page = parseDellaSearchPage(html, { pageUrl: url });
    const open = page.listings.filter((l) => !l.closed);
    closedCount = (append ? closedCount : 0) + page.listings.length - open.length;
    listings = append ? [...listings, ...open] : open;
    nextPageUrl = page.nextPageUrl;
    if (!append) save('della.url', url); // запам'ятовуємо лише робоче посилання
    $('dellaBar').hidden = false;
    $('dellaMeta').textContent = [
      page.total ? tr('На Della знайдено {n}', { n: page.total.toLocaleString(locale()) }) : '',
      tr('тут {n} відкритих', { n: listings.length }),
      tr('оновлено о {time}', { time: new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }) }),
    ]
      .filter(Boolean)
      .join(' · ');
    render();
  } catch (err) {
    if (!append) items.innerHTML = '';
    showAlert(dialog, err.message);
  }
}

$('dellaSearchForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(dialog);
  const url = urlInput.value.trim();
  try {
    dellaPath(url);
  } catch (err) {
    setFieldError(urlInput, err.message);
    urlInput.focus();
    return;
  }
  await withLoading(e.submitter ?? $('dellaSearchForm').querySelector('[type=submit]'), () => loadPage(url, { force: true }));
});

$('dellaRefresh').addEventListener('click', (e) => withLoading(e.currentTarget, () => loadPage(urlInput.value.trim(), { force: true })));
$('dellaMore').addEventListener('click', (e) => withLoading(e.currentTarget, () => loadPage(nextPageUrl, { append: true })));
$('dellaOnlyPrice').addEventListener('change', render);

// ---------- Список ----------
const canAdd = (l) => l.price && l.currency === 'UAH' && l.distanceKm && l.weightT;
const alreadyIn = (l) => ctx.getTrips().find((t) => sameCargo(t, l));

function dates(l) {
  return l.unloadDate ? `${shortDate(l.loadDate)} – ${shortDate(l.unloadDate)}` : shortDate(l.loadDate);
}

function render() {
  const onlyPrice = $('dellaOnlyPrice').checked;
  const visible = listings.map((l, i) => ({ l, i })).filter(({ l }) => !onlyPrice || l.price);
  $('dellaMore').hidden = !nextPageUrl;

  items.innerHTML = visible.length
    ? visible
        .map(({ l, i }) => {
          const existing = alreadyIn(l);
          const disabled = existing || !canAdd(l);
          const size = [l.weightT ? cargoSize(l) : '', l.bodyType].filter(Boolean).join(' · ');
          return `
      <li class="della-item${existing ? ' is-done' : ''}">
        <input class="della-item__check" type="checkbox" value="${i}" ${disabled ? 'disabled' : ''}
          aria-label="${escapeHtml(`${l.from.city} — ${l.to.city}`)}" />
        <div class="della-item__main">
          <p class="della-item__route" data-no-i18n><b>${escapeHtml(l.from.city)}</b> → <b>${escapeHtml(l.to.city)}</b>${
            l.stops.length ? ` <span class="della-item__stops" title="${escapeHtml(`через: ${l.stops.join(', ')}`)}">+${l.stops.length}</span>` : ''
          }</p>
          <p class="della-item__meta">${dates(l)} · <span data-no-i18n>${escapeHtml(l.cargoType)}</span> · ${size}${l.distanceKm ? ` · ${l.distanceKm} км` : ''}</p>
          <p class="della-item__tags">${[
            l.isNew && '<span class="della-tag della-tag--new">Нова</span>',
            l.directShipper && '<span class="della-tag">Прямий замовник</span>',
            existing && `<span class="della-tag della-tag--done">${tr('Уже в рейсах: {n}', { n: existing.number })}</span>`,
            l.posted && `<span class="della-item__posted">${escapeHtml(l.posted)}</span>`,
          ]
            .filter(Boolean)
            .join('')}</p>
        </div>
        <div class="della-item__price">
          ${
            l.price
              ? `<strong>${l.currency === 'UAH' ? money(l.price) : `${l.price.toLocaleString(locale())} ${l.currency}`}</strong>${
                  l.ratePerKm ? `<small>${l.ratePerKm.toLocaleString(locale())} грн/км</small>` : ''
                }`
              : '<small>Ціну не вказано</small>'
          }
        </div>
        <button class="btn btn--text della-item__edit" type="button" data-edit="${i}">${l.price ? 'У формі' : 'Вказати ціну'}</button>
      </li>`;
        })
        .join('')
    : `<li class="della-list__empty">${listings.length ? 'Немає вантажів із ціною на цій сторінці.' : 'Вантажів не знайдено. Змініть фільтри на Della.'}</li>`;
  updateAddButton();
}

function selected() {
  return [...items.querySelectorAll('.della-item__check:checked')].map((c) => listings[Number(c.value)]);
}

function updateAddButton() {
  const n = selected().length;
  addBtn.disabled = !n;
  addBtn.textContent = n ? tr('Додати вибрані ({n})', { n }) : 'Додати вибрані';
}

items.addEventListener('change', updateAddButton);

items.addEventListener('click', (e) => {
  const edit = e.target.closest('[data-edit]');
  if (!edit) return;
  dialog.close();
  openTripForm({ della: true, listing: listings[Number(edit.dataset.edit)] });
});

// ---------- Імпорт вибраних ----------
addBtn.addEventListener('click', async () => {
  const chosen = selected();
  if (!chosen.length) return;
  try {
    const created = await withLoading(addBtn, async () => {
      const out = [];
      for (const l of chosen) out.push(await createTrip(dellaToTrip(l))); // по черзі: номери рейсів ідуть підряд
      return out;
    });
    dialog.close();
    ctx.onCreated(created);
  } catch (err) {
    showAlert(dialog, err.message);
  }
});

$('dellaPasteBtn').addEventListener('click', () => {
  dialog.close();
  openTripForm({ della: true });
});

dialog.addEventListener('click', (e) => {
  if (e.target === dialog || e.target.closest('[data-close]')) dialog.close();
});

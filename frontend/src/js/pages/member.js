// Профіль колеги: контакти, показники й рейси менеджера (лише перегляд).
// Свій профіль редагується на profile.html — туди й перенаправляємо, якщо відкрили себе.
import { renderLayout } from '../utils/layout.js';
import { getMember, setMemberRole } from '../api/company.js';
import { getMemberKpi } from '../api/profile.js';
import { getTrips, myId, isOwner } from '../api/trips.js';
import { escapeHtml, money, TRIP_STATUS } from '../utils/format.js';
import { routeLine, statusBadge, shortDate } from '../utils/components.js';
import { avatar, shortName } from '../utils/people.js';
import { countUp } from '../utils/motion.js';
import { showToast } from '../utils/toast.js';
import { t, locale } from '../i18n/index.js';

const id = new URLSearchParams(location.search).get('id');
if (!id || id === myId()) location.replace('/pages/profile.html');

renderLayout();
const $ = (x) => document.getElementById(x);
const ROLES = { owner: 'Керівник', manager: 'Менеджер' };

const lastSeen = (iso) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function renderHead(m) {
  document.title = `${m.name} · NeVpade`;
  $('mAvatar').outerHTML = avatar(m, { size: 84 });
  $('mStatus').classList.toggle('is-offline', !m.online);
  $('mStatus').querySelector('.status__text').textContent = m.online ? t('В мережі') : t('Був(ла) {date}', { date: lastSeen(m.lastSeen) });
  $('mName').textContent = m.name;
  $('mPosition').textContent = m.position ?? '';
  $('mContacts').innerHTML = `
    <a href="tel:${escapeHtml(m.phone)}">${escapeHtml(m.phone)}</a>
    <a href="mailto:${escapeHtml(m.email)}" data-no-i18n>${escapeHtml(m.email)}</a>`;
  $('mCall').href = `tel:${m.phone}`;
  renderRole(m);
}

// Керівник може змінити роль колеги прямо тут, решта бачить позначку
function renderRole(m) {
  const role = m.role ?? 'manager';
  $('mRole').innerHTML = isOwner()
    ? `<label class="role-select"><span class="visually-hidden">Роль</span>
        <select id="mRoleSelect" aria-label="${t('Роль: {name}', { name: m.name })}">
          ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${v}</option>`).join('')}
        </select></label>`
    : `<span class="role-badge role-badge--${role}">${ROLES[role]}</span>`;
  $('mRoleSelect')?.addEventListener('change', async (e) => {
    try {
      await setMemberRole(m.id, e.target.value);
      m.role = e.target.value;
      showToast(t('{name}: {role}', { name: m.name, role: t(ROLES[m.role]) }));
    } catch (err) {
      showToast(err.message, 'error');
      e.target.value = m.role;
    }
  });
}

function renderKpi(k, active) {
  $('kTrips').textContent = k.tripsCount.toLocaleString(locale());
  $('kTripsNote').textContent = t('за весь час · {n} цього місяця', { n: k.tripsThisMonth });
  $('kPaid').innerHTML = k.paidOnTime === null ? '—' : `${k.paidOnTime}<small>%</small>`;
  $('kPaidBar').style.width = `${k.paidOnTime ?? 0}%`;
  $('kActive').textContent = k.activeTrips;
  $('kActiveNote').textContent = t('в дорозі: {n} · водіїв: {d}', { n: active.filter((x) => x.status === 'in_progress').length, d: k.activeDrivers });
  $('kRevenue').textContent = money(k.revenueThisMonth);
  ['kTrips', 'kActive'].forEach((x) => countUp($(x)));
}

const tripItem = (tr) => `
  <li><a href="/pages/trips.html?trip=${tr.id}"><strong>${escapeHtml(tr.number)}</strong> ${shortDate(tr.loadDate)}</a>
    ${routeLine(tr)}
    <span>${statusBadge(tr.status, TRIP_STATUS)}</span></li>`;

async function init() {
  try {
    const [m, kpi, trips] = await Promise.all([getMember(id), getMemberKpi(id), getTrips()]);
    const mine = trips.filter((tr) => tr.managerId === id);
    const active = mine.filter((tr) => ['in_progress', 'planned'].includes(tr.status)).sort((a, b) => (a.status === b.status ? a.loadDate.localeCompare(b.loadDate) : a.status === 'in_progress' ? -1 : 1));
    const done = mine.filter((tr) => tr.status === 'done').sort((a, b) => b.loadDate.localeCompare(a.loadDate)).slice(0, 5);
    renderHead(m);
    renderKpi(kpi, active);
    $('mAllTrips').href = `/pages/trips.html?manager=${encodeURIComponent(id)}`;
    $('mAllTrips').textContent = t('Усі рейси ({n})', { n: mine.length });
    $('mActive').innerHTML = active.length ? active.map(tripItem).join('') : `<li class="mini-trips__empty">${t('{name} зараз без рейсів', { name: escapeHtml(shortName(m.name)) })}</li>`;
    $('mDone').innerHTML = done.length ? done.map(tripItem).join('') : `<li class="mini-trips__empty">${t('Виконаних рейсів ще немає')}</li>`;
  } catch (err) {
    document.querySelector('.member-page').innerHTML = `
      <a class="back-link" href="/pages/team.html">← Команда</a>
      <div class="empty"><p class="empty__title">${escapeHtml(err.message)}</p><p>${t('Можливо, колега вже не в компанії.')}</p></div>`;
  } finally {
    document.querySelector('.member-page')?.classList.remove('is-loading');
  }
}

init();

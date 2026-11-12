// Команда: менеджери компанії, код запрошення
import { renderLayout } from '../utils/layout.js';
import { getCompany, getMembers, regenerateInvite } from '../api/company.js';
import { getTrips, myId } from '../api/trips.js';
import { escapeHtml } from '../utils/format.js';
import { avatar } from '../utils/people.js';
import { icons } from '../utils/icons.js';
import { copyText } from '../utils/viber.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import { locale, t } from '../i18n/index.js';

renderLayout();

let members = [];
let trips = [];

const lastSeen = (iso) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function render() {
  const q = document.getElementById('memberSearch').value.trim().toLowerCase();
  const list = members.filter((m) => `${m.name} ${m.position}`.toLowerCase().includes(q));

  document.getElementById('members').innerHTML = list.length
    ? list
        .map((m) => {
          const active = trips.filter((tr) => tr.managerId === m.id && tr.status !== 'done').length;
          const me = m.id === myId();
          return `
        <li class="member">
          ${avatar(m, { size: 46 })}
          <div class="member__main">
            <strong class="member__name" data-no-i18n>${escapeHtml(m.name)}</strong>${me ? ' <span class="member__you">це ви</span>' : ''}
            <span class="member__pos">${escapeHtml(m.position)}</span>
            <span class="member__status ${m.online ? 'is-online' : ''}">${m.online ? 'В мережі' : `Був(ла) ${lastSeen(m.lastSeen)}`}</span>
          </div>
          <div class="member__contacts">
            <a href="tel:${m.phone}">${m.phone}</a>
            <a href="mailto:${m.email}" data-no-i18n>${escapeHtml(m.email)}</a>
          </div>
          <div class="member__load" title="Активні рейси (заплановані й у дорозі)">
            <strong>${active}</strong><span>активних рейсів</span>
          </div>
          <div class="member__actions">
            ${me ? '' : `<a class="icon-btn" href="/pages/chat.html" title="Написати в чаті" aria-label="Написати в чаті">${icons.chat}</a>
            <a class="icon-btn" href="tel:${m.phone}" title="Подзвонити" aria-label="Подзвонити">${icons.phone}</a>`}
          </div>
        </li>`;
        })
        .join('')
    : '<li class="empty"><p class="empty__title">Нікого не знайдено</p></li>';
}

async function init() {
  document.getElementById('copyInvite').innerHTML = icons.copy;
  const [company, m, tr] = await Promise.all([getCompany(), getMembers(), getTrips()]);
  members = m;
  trips = tr;

  const online = members.filter((x) => x.online).length;
  document.getElementById('teamSummary').textContent = t('{n} менеджерів · {m} зараз у мережі', { n: members.length, m: online });
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('inviteCode').textContent = company.inviteCode;
  document.getElementById('companyFacts').innerHTML = `
    <div><dt>Місто</dt><dd data-no-i18n>${escapeHtml(company.city ?? '—')}</dd></div>
    <div><dt>У системі з</dt><dd>${new Date(company.createdAt).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</dd></div>
    <div><dt>Рейсів у роботі</dt><dd>${trips.filter((x) => x.status !== 'done').length}</dd></div>`;
  render();
}

document.getElementById('memberSearch').addEventListener('input', render);

document.getElementById('copyInvite').addEventListener('click', async () => {
  try {
    await copyText(document.getElementById('inviteCode').textContent);
    showToast('Код запрошення скопійовано');
  } catch {
    showToast('Не вдалося скопіювати', 'error');
  }
});

document.getElementById('regenInvite').addEventListener('click', async () => {
  const ok = await confirmDialog({
    title: 'Створити новий код?',
    text: 'Старий код перестане діяти. Колеги, які вже в компанії, нічого не помітять.',
    confirmText: 'Створити код',
  });
  if (!ok) return;
  try {
    const { inviteCode } = await regenerateInvite();
    document.getElementById('inviteCode').textContent = inviteCode;
    showToast('Новий код створено');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

init();

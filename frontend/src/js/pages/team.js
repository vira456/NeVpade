// Команда: менеджери компанії (з переходом на профіль кожного), код компанії, перехід в іншу компанію
import { renderLayout } from '../utils/layout.js';
import { getCompany, getMembers, switchCompany, myActiveTrips } from '../api/company.js';
import { isMockMode } from '../api/client.js';
import { nextPageFor } from '../api/auth.js';
import { initCompanyField } from '../utils/company-field.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';
import { getTrips, myId } from '../api/trips.js';
import { escapeHtml, plural } from '../utils/format.js';
import { avatar } from '../utils/people.js';
import { icons } from '../utils/icons.js';
import { showToast } from '../utils/toast.js';
import { confirmDialog } from '../utils/confirm.js';
import { locale, t } from '../i18n/index.js';

renderLayout();

let members = [];
let owners = [];
let trips = [];

const lastSeen = (iso) =>
  iso ? new Date(iso).toLocaleString(locale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

// Свій профіль — сторінка редагування, колеги — сторінка перегляду
const profileHref = (m) => (m.id === myId() ? '/pages/profile.html' : `/pages/member.html?id=${encodeURIComponent(m.id)}`);

function render() {
  const q = document.getElementById('memberSearch').value.trim().toLowerCase();
  const list = members.filter((m) => `${m.name} ${m.position}`.toLowerCase().includes(q));

  document.getElementById('members').innerHTML = list.length
    ? list
        .map((m) => {
          const active = trips.filter((tr) => tr.managerId === m.id && ['planned', 'in_progress'].includes(tr.status)).length;
          const me = m.id === myId();
          return `
        <li class="member">
          <a class="member__avatar" href="${profileHref(m)}" tabindex="-1" aria-hidden="true">${avatar(m, { size: 46 })}</a>
          <div class="member__main">
            <a class="member__name" href="${profileHref(m)}" data-no-i18n>${escapeHtml(m.name)}</a>${me ? ' <span class="member__you">це ви</span>' : ''}
            <span class="member__pos">${escapeHtml(m.position)}</span>
            <span class="member__status ${m.online ? 'is-online' : ''}">${m.online ? 'В мережі' : m.lastSeen ? `Був(ла) ${lastSeen(m.lastSeen)}` : 'Не в мережі'}</span>
          </div>
          <div class="member__contacts">
            ${m.phone ? `<a href="tel:${escapeHtml(m.phone)}">${escapeHtml(m.phone)}</a>` : ''}
            ${m.email ? `<a href="mailto:${escapeHtml(m.email)}" data-no-i18n>${escapeHtml(m.email)}</a>` : ''}
          </div>
          <div class="member__load" title="Активні рейси (заплановані й у дорозі)">
            <strong>${active}</strong><span>активних рейсів</span>
          </div>
          <div class="member__actions">
            ${me ? '' : `<a class="icon-btn" href="/pages/chat.html" title="Написати в чаті" aria-label="Написати в чаті">${icons.chat}</a>
            ${m.phone ? `<a class="icon-btn" href="tel:${escapeHtml(m.phone)}" title="Подзвонити" aria-label="Подзвонити">${icons.phone}</a>` : ''}`}
          </div>
        </li>`;
        })
        .join('')
    : '<li class="empty"><p class="empty__title">Нікого не знайдено</p></li>';
}

async function init() {
  const [company, m, tr] = await Promise.all([getCompany(), getMembers(), getTrips()]);
  // власник працює у своєму кабінеті, тож у команді — лише менеджери; власника показуємо в картці компанії
  owners = m.filter((x) => x.role === 'owner');
  members = m.filter((x) => x.role !== 'owner');
  trips = tr;

  const online = members.filter((x) => x.online).length;
  document.getElementById('teamSummary').textContent = t(plural(members.length, ['{n} менеджер · {m} зараз у мережі', '{n} менеджери · {m} зараз у мережі', '{n} менеджерів · {m} зараз у мережі']), { n: members.length, m: online });
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('companyFacts').innerHTML = `
    <div><dt>${owners.length > 1 ? 'Власники' : 'Власник'}</dt><dd data-no-i18n>${owners.length ? owners.map((o) => escapeHtml(o.name)).join(', ') : '—'}</dd></div>
    <div><dt>Місто</dt><dd data-no-i18n>${escapeHtml(company.city ?? '—')}</dd></div>
    <div><dt>У системі з</dt><dd>${new Date(company.createdAt).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</dd></div>
    <div><dt>Рейсів у роботі</dt><dd>${trips.filter((x) => ['planned', 'in_progress'].includes(x.status)).length}</dd></div>`;
  render();
}

document.getElementById('memberSearch').addEventListener('input', render);

// ---------- Змінити компанію ----------
const switchDialog = document.getElementById('switchDialog');
const switchForm = document.getElementById('switchForm');
const company = initCompanyField(switchForm);
document.getElementById('switchMockHint').hidden = !isMockMode;

document.getElementById('switchCompanyBtn').addEventListener('click', () => {
  clearErrors(switchForm);
  switchForm.reset();
  switchForm.querySelector('[name=companyMode][value=join]').dispatchEvent(new Event('change'));
  // що станеться з моїми справами — кажемо одразу, а не після помилки
  const note = document.getElementById('switchNote');
  const active = myActiveTrips(trips, myId());
  const lines = [];
  if (active.length)
    lines.push(
      t('У вас активні рейси ({n}). Передайте їх колегам на сторінці «Рейси» до переходу — інакше вони залишаться без менеджера. Виконані рейси залишаться в історії компанії.', { n: active.length })
    );
  note.hidden = !lines.length;
  note.innerHTML = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  switchDialog.showModal();
});
switchDialog.addEventListener('click', (e) => {
  if (e.target === switchDialog || e.target.closest('[data-cancel]')) switchDialog.close();
});

switchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(switchForm);
  const err = company.error();
  if (err) return setFieldError(company.input, err);
  const value = company.value();
  const ok = await confirmDialog({
    title: t('Надіслати заявку в компанію з кодом {code}?', { code: value.code }),
    text: t('Доступ до «{name}» закриється одразу. Нову компанію ви побачите, коли її власник прийме заявку.', { name: document.getElementById('companyName').textContent }),
    confirmText: 'Надіслати заявку',
  });
  if (!ok) return;
  try {
    const res = await withLoading(document.getElementById('switchSubmit'), () => switchCompany(value));
    switchDialog.close();
    showToast(t('Заявку до {name} надіслано', { name: res.user.companyName }));
    setTimeout(() => location.replace(nextPageFor(res.user)), 700);
  } catch (err2) {
    if (err2.code === 'company_not_found' || err2.code === 'same_company') setFieldError(company.input, err2.message);
    else showAlert(switchForm, err2.message);
  }
});

init();

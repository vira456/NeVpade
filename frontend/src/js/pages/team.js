// Команда: менеджери компанії (з переходом на профіль кожного), код запрошення, перехід в іншу компанію
import { renderLayout } from '../utils/layout.js';
import { getCompany, getMembers, regenerateInvite, setMemberRole, switchCompany, myActiveTrips } from '../api/company.js';
import { isMockMode } from '../api/client.js';
import { initCompanyField } from '../utils/company-field.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';
import { getTrips, myId, isOwner } from '../api/trips.js';
import { escapeHtml, plural } from '../utils/format.js';
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

const ROLES = { owner: 'Керівник', manager: 'Менеджер' };

// Керівник бачить перемикач ролі, решта — лише позначку
function roleControl(m) {
  const role = m.role ?? 'manager';
  if (!isOwner()) return `<span class="role-badge role-badge--${role}">${ROLES[role]}</span>`;
  return `<label class="role-select"><span class="visually-hidden">Роль</span>
    <select data-role="${m.id}" aria-label="${t('Роль: {name}', { name: m.name })}">
      ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === role ? 'selected' : ''}>${v}</option>`).join('')}
    </select></label>`;
}

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
            ${roleControl(m)}
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
  document.getElementById('copyInvite').innerHTML = icons.copy;
  const [company, m, tr] = await Promise.all([getCompany(), getMembers(), getTrips()]);
  members = m;
  trips = tr;

  const online = members.filter((x) => x.online).length;
  document.getElementById('teamSummary').textContent = t(plural(members.length, ['{n} менеджер · {m} зараз у мережі', '{n} менеджери · {m} зараз у мережі', '{n} менеджерів · {m} зараз у мережі']), { n: members.length, m: online });
  document.getElementById('companyName').textContent = company.name;
  document.getElementById('inviteCode').textContent = company.inviteCode;
  document.getElementById('companyFacts').innerHTML = `
    <div><dt>Місто</dt><dd data-no-i18n>${escapeHtml(company.city ?? '—')}</dd></div>
    <div><dt>У системі з</dt><dd>${new Date(company.createdAt).toLocaleDateString(locale(), { month: 'long', year: 'numeric' })}</dd></div>
    <div><dt>Рейсів у роботі</dt><dd>${trips.filter((x) => ['planned', 'in_progress'].includes(x.status)).length}</dd></div>`;
  render();
}

document.getElementById('memberSearch').addEventListener('input', render);

document.getElementById('members').addEventListener('change', async (e) => {
  const sel = e.target.closest('[data-role]');
  if (!sel) return;
  const m = members.find((x) => x.id === sel.dataset.role);
  const role = sel.value;
  if (m.id === myId() && role !== 'owner') {
    const ok = await confirmDialog({
      title: 'Зняти з себе роль керівника?',
      text: 'Ви більше не зможете видаляти машини, водіїв і клієнтів, змінювати чужі рейси та ролі колег.',
      confirmText: 'Зняти роль',
    });
    if (!ok) return render();
  }
  try {
    await setMemberRole(m.id, role);
    m.role = role;
    showToast(t('{name}: {role}', { name: m.name, role: t(ROLES[role]) }));
  } catch (err) {
    showToast(err.message, 'error');
  }
  render();
});

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
  const me = members.find((m) => m.id === myId());
  const lastOwner = me?.role === 'owner' && members.length > 1 && !members.some((m) => m.id !== me.id && m.role === 'owner');
  const lines = [];
  if (lastOwner) lines.push(t('Ви єдиний керівник. Спершу призначте керівником когось із колег — інакше компанія залишиться без керівника.'));
  if (active.length)
    lines.push(
      t('Ваші активні рейси ({n}) перейдуть до керівника компанії. Виконані рейси залишаться в її історії.', { n: active.length })
    );
  note.hidden = !lines.length;
  note.innerHTML = lines.map((l) => `<p>${escapeHtml(l)}</p>`).join('');
  note.classList.toggle('is-bad', lastOwner);
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
    title: value.mode === 'create' ? t('Створити «{name}» і перейти?', { name: value.name }) : t('Перейти в компанію за кодом {code}?', { code: value.code }),
    text: t('Доступ до «{name}» закриється. Повернутися можна буде лише за новим кодом запрошення.', { name: document.getElementById('companyName').textContent }),
    confirmText: 'Перейти',
  });
  if (!ok) return;
  try {
    const res = await withLoading(document.getElementById('switchSubmit'), () => switchCompany(value));
    switchDialog.close();
    showToast(t('Тепер ви в компанії {name}', { name: res.user.companyName }));
    setTimeout(() => location.replace('/pages/dashboard.html'), 700);
  } catch (err2) {
    if (err2.code === 'company_not_found' || err2.code === 'same_company') setFieldError(company.input, err2.message);
    else showAlert(switchForm, err2.message);
  }
});

init();

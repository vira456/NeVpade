// Кабінет власника → Мій акаунт (відкривається з картки користувача внизу бокової панелі):
// дані власника й назва та місто компанії
import { renderLayout, initials, renderSidebarUser } from '../../utils/layout.js';
import { getCompany, getMembers, updateCompany } from '../../api/company.js';
import { getCurrentUser } from '../../api/auth.js';
import { escapeHtml } from '../../utils/format.js';
import { showToast } from '../../utils/toast.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../../utils/validation.js';
import { locale, t } from '../../i18n/index.js';
import { $ } from './common.js';

let saved = { name: '', city: '' };

function renderAccount() {
  const me = getCurrentUser();
  $('acctAvatar').innerHTML = me?.avatarUrl ? `<img src="${escapeHtml(me.avatarUrl)}" alt="" />` : escapeHtml(initials(me?.name));
  $('acctName').textContent = me?.name ?? '';
  $('acctCompany').textContent = me?.companyName ?? '';
  const rows = [
    ['Email', me?.email],
    ['Телефон', me?.phone],
  ].filter(([, v]) => v);
  $('accountFacts').innerHTML = rows.map(([k, v]) => `<div><dt>${t(k)}</dt><dd data-no-i18n>${escapeHtml(v)}</dd></div>`).join('');
}

function renderCompany(company, managersCount) {
  saved = { name: company?.name ?? '', city: company?.city ?? '' };
  $('coName').value = saved.name;
  $('coCity').value = saved.city;
  syncSave();
  $('coCode').textContent = company?.inviteCode ?? '—';
  $('coSince').textContent = company?.createdAt ? new Date(company.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
  if (managersCount != null) $('coManagers').textContent = String(managersCount);
}

// «Зберегти» активна, лише коли щось змінили
function syncSave() {
  const changed = $('coName').value.trim() !== saved.name || $('coCity').value.trim() !== saved.city;
  $('companySave').disabled = !changed;
}

async function init() {
  renderAccount();
  const [company, members] = await Promise.all([getCompany().catch(() => null), getMembers().catch(() => null)]);
  renderCompany(company, members ? members.filter((m) => m.role !== 'owner').length : null);
}

function bindEvents() {
  const form = $('companyForm');
  form.addEventListener('input', syncSave);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(form);
    const name = $('coName').value.trim();
    const city = $('coCity').value.trim();
    if (name.length < 2) return setFieldError($('coName'), 'Вкажіть назву компанії');
    try {
      const company = await withLoading($('companySave'), () => updateCompany({ name, city }));
      saved = { name: company?.name ?? name, city: company?.city ?? city };
      syncSave();
      renderAccount();
      renderSidebarUser();
      showToast('Дані компанії збережено');
    } catch (err) {
      showAlert(form, err.message);
    }
  });
}

if (renderLayout({ access: 'owner' })) {
  bindEvents();
  init();
}

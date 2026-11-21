// Кабінет власника → Компанія і доступ: назва й місто, акаунт, передача компанії
import { renderLayout } from '../../utils/layout.js';
import { getMembers, updateCompany, transferOwnership } from '../../api/company.js';
import { getCurrentUser, homeFor } from '../../api/auth.js';
import { getTrips } from '../../api/trips.js';
import { escapeHtml } from '../../utils/format.js';
import { showToast } from '../../utils/toast.js';
import { confirmDialog } from '../../utils/confirm.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../../utils/validation.js';
import { t } from '../../i18n/index.js';
import { $, renderCompanyLine } from './common.js';

let managers = [];
let activeBy = new Map(); // активні рейси кожного менеджера

function renderAccount() {
  const me = getCurrentUser();
  const rows = [
    ['Ім\'я', me?.name],
    ['Email', me?.email],
    ['Телефон', me?.phone],
  ].filter(([, v]) => v);
  // дані акаунта не перекладаємо, а підпис ролі — так
  $('accountFacts').innerHTML =
    rows.map(([k, v]) => `<div><dt>${k}</dt><dd data-no-i18n>${escapeHtml(v)}</dd></div>`).join('') + '<div><dt>Роль</dt><dd>Власник компанії</dd></div>';
}

function renderTransfer() {
  $('transferTo').innerHTML = managers.length
    ? `<option value="">${t('Оберіть менеджера')}</option>` + managers.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')
    : `<option value="">${t('У компанії ще немає менеджерів')}</option>`;
  $('transferTo').disabled = !managers.length;
  $('transferSubmit').disabled = !managers.length;
  syncTripsTo();
}

// Новий власник рейсів не веде — якщо в нього є активні, обираємо, хто їх продовжить
function syncTripsTo() {
  const id = $('transferTo').value;
  const n = activeBy.get(id) ?? 0;
  $('tripsToField').hidden = !n;
  if (!n) return;
  const others = managers.filter((m) => m.id !== id);
  $('tripsTo').innerHTML = others.length
    ? `<option value="">${t('Оберіть менеджера')}</option>` + others.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')
    : `<option value="">${t('Інших менеджерів немає')}</option>`;
  $('tripsToHint').textContent = t('Активних рейсів: {n}. Власник рейсів не веде, тож їх продовжить інший менеджер.', { n });
}

async function init() {
  renderAccount();
  const [company, members, trips] = await Promise.all([renderCompanyLine(), getMembers().catch(() => []), getTrips().catch(() => [])]);
  activeBy = new Map();
  trips.filter((tr) => ['planned', 'in_progress'].includes(tr.status)).forEach((tr) => activeBy.set(tr.managerId, (activeBy.get(tr.managerId) ?? 0) + 1));
  $('coName').value = company?.name ?? '';
  $('coCity').value = company?.city ?? '';
  managers = members.filter((m) => m.role !== 'owner');
  renderTransfer();
}

function bindEvents() {
  // ---------- Компанія ----------
  const companyForm = $('companyForm');
  companyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(companyForm);
    const name = $('coName').value.trim();
    if (name.length < 2) return setFieldError($('coName'), 'Вкажіть назву компанії');
    try {
      await withLoading($('companySave'), () => updateCompany({ name, city: $('coCity').value.trim() }));
      await renderCompanyLine();
      document.querySelectorAll('.sidebar__company').forEach((el) => (el.textContent = name));
      showToast('Дані компанії збережено');
    } catch (err) {
      showAlert(companyForm, err.message);
    }
  });

  // ---------- Передача компанії ----------
  const transferForm = $('transferForm');
  $('transferTo').addEventListener('change', syncTripsTo);
  transferForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(transferForm);
    const id = $('transferTo').value;
    if (!id) return setFieldError($('transferTo'), 'Оберіть, кому передати компанію');
    const tripsTo = $('tripsToField').hidden ? null : $('tripsTo').value;
    if (!$('tripsToField').hidden && !tripsTo) return setFieldError($('tripsTo'), 'Оберіть, кому передати рейси');
    const m = managers.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: t('Передати компанію {name}?', { name: m.name }),
      text: 'Ви станете менеджером і втратите доступ до кабінету власника. Повернути компанію зможе лише новий власник.',
      confirmText: 'Передати',
    });
    if (!ok) return;
    try {
      await withLoading($('transferSubmit'), () => transferOwnership(id, { tripsTo }));
      showToast(t('Тепер власник компанії — {name}', { name: m.name }), 'success', 5000);
      setTimeout(() => location.replace(homeFor(getCurrentUser())), 1600);
    } catch (err) {
      showAlert(transferForm, err.message);
    }
  });
}

if (renderLayout({ access: 'owner' })) {
  bindEvents();
  init();
}

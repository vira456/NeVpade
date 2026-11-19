// Кабінет власника → Компанія і доступ: назва й місто, код власника, акаунт, передача компанії
import { renderLayout } from '../../utils/layout.js';
import { getMembers, updateCompany, transferOwnership } from '../../api/company.js';
import { getCurrentUser, regenerateOwnerCode, homeFor } from '../../api/auth.js';
import { isMockMode } from '../../api/client.js';
import { escapeHtml } from '../../utils/format.js';
import { showToast } from '../../utils/toast.js';
import { confirmDialog } from '../../utils/confirm.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../../utils/validation.js';
import { t } from '../../i18n/index.js';
import { $, renderCompanyLine, showOwnerCode } from './common.js';

let managers = [];

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
}

async function init() {
  renderAccount();
  const [company, members] = await Promise.all([renderCompanyLine(), getMembers().catch(() => [])]);
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

  // ---------- Код власника ----------
  const regenDialog = $('regenDialog');
  const regenForm = $('regenForm');
  $('regenCodeBtn').addEventListener('click', () => {
    regenForm.reset();
    clearErrors(regenForm);
    regenDialog.showModal();
  });
  regenDialog.addEventListener('click', (e) => {
    if (e.target === regenDialog || e.target.closest('[data-cancel]')) regenDialog.close();
  });
  regenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(regenForm);
    const password = regenForm.elements.password;
    if (!password.value) return setFieldError(password, 'Введіть пароль');
    try {
      const { ownerCode } = await withLoading($('regenSubmit'), () => regenerateOwnerCode(password.value));
      regenDialog.close();
      showOwnerCode(ownerCode);
    } catch (err) {
      if (err.code === 'wrong_password') setFieldError(password, err.message);
      else showAlert(regenForm, err.message);
    }
  });

  // ---------- Передача компанії ----------
  const transferForm = $('transferForm');
  transferForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(transferForm);
    const id = $('transferTo').value;
    if (!id) return setFieldError($('transferTo'), 'Оберіть, кому передати компанію');
    const m = managers.find((x) => x.id === id);
    const ok = await confirmDialog({
      title: t('Передати компанію {name}?', { name: m.name }),
      text: 'Ви станете менеджером і втратите доступ до кабінету власника. Повернути компанію зможе лише новий власник.',
      confirmText: 'Передати',
    });
    if (!ok) return;
    try {
      const res = await withLoading($('transferSubmit'), () => transferOwnership(id));
      showToast(
        isMockMode && res?.mockCode
          ? t('Тепер власник — {name}. Режим моків: його код {code}', { name: m.name, code: res.mockCode })
          : t('Тепер власник компанії — {name}. Код власника надіслано йому на пошту', { name: m.name }),
        'success',
        6000
      );
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

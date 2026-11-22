import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { login, nextPageFor, demoAccounts, MOCK_PASSWORD, formatCompanyCode, isCompanyCode, mockCompanyCode } from '../api/auth.js';
import { isMockMode } from '../api/client.js';
import { escapeHtml } from '../utils/format.js';
import { t } from '../i18n/index.js';
import { initSocialButtons } from '../utils/social.js';
import { isEmail, setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('loginForm');
const email = form.elements.email;
const password = form.elements.password;

// Повідомлення після реєстрації / зміни пароля
const notice = sessionStorage.getItem('authNotice');
if (notice) {
  showAlert(form, notice, 'success');
  sessionStorage.removeItem('authNotice');
}

const goHome = (user) => location.replace(nextPageFor(user));

// ---------- Менеджер чи власник ----------
const companyCode = form.elements.companyCode;
const HINTS = {
  manager: 'Рейси, клієнти, автопарк і чат компанії. Потрібен код компанії від власника.',
  owner: 'Кабінет власника: менеджери, фінанси й налаштування компанії.',
};
const role = () => form.elements.role.value;
function syncRole() {
  const owner = role() === 'owner';
  // код компанії вводить лише менеджер — власник його й видає
  document.getElementById('companyCodeField').hidden = owner;
  document.getElementById('roleHint').textContent = HINTS[role()];
  form.querySelectorAll('.role-pick .seg__btn').forEach((l) => l.setAttribute('aria-pressed', String(l.querySelector('input').checked)));
  // реєстрація теж окрема: менеджер — за кодом компанії, власник — створює компанію
  document.getElementById('registerHint').innerHTML = owner
    ? `${t('Ще немає компанії?')} <a href="/pages/register-owner.html">${t('Зареєструвати компанію')}</a>`
    : `${t('Немає акаунта?')} <a href="/pages/register.html">${t('Зареєструватися як менеджер')}</a>`;
  clearErrors(form);
}
form.querySelectorAll('[name=role]').forEach((r) => r.addEventListener('change', syncRole));
// ?role=owner — посилання «Увійти як власник» з лендингу
if (new URLSearchParams(location.search).get('role') === 'owner') form.elements.role.value = 'owner';
syncRole();

// NVP-1234: великі літери й дефіс підставляються самі
companyCode.addEventListener('input', () => {
  companyCode.value = formatCompanyCode(companyCode.value);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  let ok = true;
  if (!isEmail(email.value)) (setFieldError(email, 'Введіть коректний email'), (ok = false));
  if (!password.value) (setFieldError(password, 'Введіть пароль'), (ok = false));
  if (role() === 'manager' && !isCompanyCode(companyCode.value)) (setFieldError(companyCode, 'Введіть код компанії у форматі NVP-1234'), (ok = false));
  if (!ok) return;

  try {
    const user = await withLoading(document.getElementById('loginSubmit'), () =>
      login(email.value.trim(), password.value, { role: role(), companyCode: companyCode.value })
    );
    goHome(user);
  } catch (err) {
    // Бекенд повертає code: "email_not_verified", якщо пошту ще не підтверджено
    if (err.code === 'email_not_verified') {
      rememberEmail(email.value.trim());
      location.href = `/pages/verify-email.html?email=${encodeURIComponent(email.value.trim())}`;
      return;
    }
    if (err.code === 'invalid_company_code') {
      companyCode.select();
      return setFieldError(companyCode, err.message);
    }
    showAlert(form, err.message);
  }
});

initSocialButtons({
  onSuccess: goHome,
  onError: (msg) => showAlert(form, msg),
  text: 'signin_with',
  getCompanyCode: () => companyCode.value,
  getRole: role,
});

// ---------- Демо-акаунти (лише режим моків) ----------
if (isMockMode) {
  const accounts = demoAccounts();
  if (accounts.length) {
    document.getElementById('demoAccounts').hidden = false;
    document.getElementById('demoPassword').textContent = MOCK_PASSWORD;
    document.getElementById('demoCompanyCode').textContent = mockCompanyCode();
    document.getElementById('demoList').innerHTML = accounts
      .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1))
      .map(
        (a) => `<li><button class="demo-accounts__btn" type="button" data-email="${escapeHtml(a.email)}" data-role="${a.role}">
          <span class="role-badge role-badge--${a.role}">${a.role === 'owner' ? 'Власник' : 'Менеджер'}</span>
          <span class="demo-accounts__name" data-no-i18n>${escapeHtml(a.name)}</span></button></li>`
      )
      .join('');
    document.getElementById('demoList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-email]');
      if (!btn) return;
      form.elements.role.value = btn.dataset.role;
      syncRole();
      email.value = btn.dataset.email;
      password.value = MOCK_PASSWORD;
      companyCode.value = btn.dataset.role === 'manager' ? mockCompanyCode() : '';
      form.requestSubmit();
    });
  }
}

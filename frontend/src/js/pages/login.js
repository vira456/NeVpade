import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { login, nextPageFor, demoAccounts, MOCK_PASSWORD, formatOwnerCode, isOwnerCode, resetOwnerCode } from '../api/auth.js';
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
const ownerCode = form.elements.ownerCode;
const HINTS = {
  manager: 'Рейси, клієнти, автопарк і чат компанії.',
  owner: 'Кабінет власника: менеджери, фінанси й налаштування компанії. Потрібен код власника.',
};
const role = () => form.elements.role.value;
function syncRole() {
  const owner = role() === 'owner';
  document.getElementById('ownerCodeField').hidden = !owner;
  document.getElementById('forgotCodeBtn').hidden = !owner;
  document.getElementById('forgotSpacer').hidden = owner;
  document.getElementById('roleHint').textContent = HINTS[role()];
  // власник входить лише поштою, паролем і кодом — без Google
  form.querySelectorAll('[data-social]').forEach((el) => (el.hidden = owner));
  // реєстрація теж окрема: менеджер — за кодом запрошення, власник — створює компанію
  document.getElementById('registerHint').innerHTML = owner
    ? `${t('Ще немає компанії?')} <a href="/pages/register-owner.html">${t('Зареєструвати компанію')}</a>`
    : `${t('Немає акаунта?')} <a href="/pages/register.html">${t('Зареєструватися як менеджер')}</a>`;
  form.querySelectorAll('.role-pick .seg__btn').forEach((l) => l.setAttribute('aria-pressed', String(l.querySelector('input').checked)));
  clearErrors(form);
}
form.querySelectorAll('[name=role]').forEach((r) => r.addEventListener('change', syncRole));
// ?role=owner — посилання «Увійти як власник» з лендингу
if (new URLSearchParams(location.search).get('role') === 'owner') form.elements.role.value = 'owner';
syncRole();

ownerCode.addEventListener('input', () => {
  const pos = ownerCode.selectionStart === ownerCode.value.length;
  ownerCode.value = formatOwnerCode(ownerCode.value);
  if (pos) ownerCode.setSelectionRange(ownerCode.value.length, ownerCode.value.length);
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  let ok = true;
  if (!isEmail(email.value)) (setFieldError(email, 'Введіть коректний email'), (ok = false));
  if (!password.value) (setFieldError(password, 'Введіть пароль'), (ok = false));
  if (role() === 'owner' && !isOwnerCode(ownerCode.value)) (setFieldError(ownerCode, 'Введіть код власника у форматі OWN-XXXX-XXXX'), (ok = false));
  if (!ok) return;

  try {
    const user = await withLoading(document.getElementById('loginSubmit'), () =>
      login(email.value.trim(), password.value, { role: role(), ownerCode: ownerCode.value })
    );
    goHome(user);
  } catch (err) {
    // Бекенд повертає code: "email_not_verified", якщо пошту ще не підтверджено
    if (err.code === 'email_not_verified') {
      rememberEmail(email.value.trim());
      location.href = `/pages/verify-email.html?email=${encodeURIComponent(email.value.trim())}`;
      return;
    }
    if (err.code === 'invalid_owner_code') {
      ownerCode.select();
      return setFieldError(ownerCode, err.message);
    }
    showAlert(form, err.message);
  }
});

initSocialButtons({ onSuccess: goHome, onError: (msg) => showAlert(form, msg), text: 'signin_with' });

// ---------- Забули код власника ----------
const codeDialog = document.getElementById('forgotCodeDialog');
const codeForm = document.getElementById('forgotCodeForm');
document.getElementById('forgotCodeBtn').addEventListener('click', () => {
  clearErrors(codeForm);
  codeForm.elements.email.value = email.value.trim();
  codeDialog.showModal();
});
codeDialog.addEventListener('click', (e) => {
  if (e.target === codeDialog || e.target.closest('[data-cancel]')) codeDialog.close();
});
codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(codeForm);
  const mail = codeForm.elements.email;
  if (!isEmail(mail.value)) return setFieldError(mail, 'Введіть коректний email');
  try {
    const res = await withLoading(document.getElementById('forgotCodeSubmit'), () => resetOwnerCode(mail.value.trim()));
    codeDialog.close();
    email.value = mail.value.trim();
    // у моках листа немає — показуємо новий код одразу
    showAlert(form, res.mockCode ? t('{msg}. Режим моків: новий код — {code}', { msg: t(res.message), code: res.mockCode }) : res.message, 'success');
    if (res.mockCode) ownerCode.value = res.mockCode;
  } catch (err) {
    showAlert(codeForm, err.message);
  }
});

// ---------- Демо-акаунти (лише режим моків) ----------
if (isMockMode) {
  const accounts = demoAccounts();
  if (accounts.length) {
    document.getElementById('demoAccounts').hidden = false;
    document.getElementById('demoPassword').textContent = MOCK_PASSWORD;
    document.getElementById('demoList').innerHTML = accounts
      .sort((a, b) => (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1))
      .map(
        (a) => `<li><button class="demo-accounts__btn" type="button" data-email="${escapeHtml(a.email)}" data-role="${a.role}" data-code="${escapeHtml(a.code ?? '')}">
          <span class="role-badge role-badge--${a.role}">${a.role === 'owner' ? 'Власник' : 'Менеджер'}</span>
          <span class="demo-accounts__name" data-no-i18n>${escapeHtml(a.name)}</span>
          ${a.code ? `<code class="demo-accounts__code" data-no-i18n>${escapeHtml(a.code)}</code>` : ''}</button></li>`
      )
      .join('');
    document.getElementById('demoList').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-email]');
      if (!btn) return;
      form.elements.role.value = btn.dataset.role;
      syncRole();
      email.value = btn.dataset.email;
      password.value = MOCK_PASSWORD;
      ownerCode.value = btn.dataset.code;
      form.requestSubmit();
    });
  }
}

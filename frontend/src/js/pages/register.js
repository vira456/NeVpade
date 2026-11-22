import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { register, registerWithGoogle } from '../api/auth.js';
import { initGoogleButton, googleProfile, takeGoogleCredential } from '../utils/social.js';
import { escapeHtml } from '../utils/format.js';
import { initCompanyField } from '../utils/company-field.js';
import { isEmail, fullNameError, capitalizeName, phoneDigits, formatPhoneInput, phoneError, toE164, passwordProblems, setFieldError, validateOnBlur, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('registerForm');
const { name, email, phone, password, confirm, terms } = form.elements;
// Дві окремі сторінки з одним скриптом: register.html — менеджер (код компанії),
// register-owner.html — власник (створює компанію). На обох можна зареєструватися через Google
const isOwner = form.dataset.role === 'owner';
const company = initCompanyField(form);
const rules = document.getElementById('passwordRules');

// Ім'я: не даємо вводити цифри та символи, перевіряємо при виході з поля
name.addEventListener('input', () => {
  const cleaned = name.value.replace(/[^A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії'’ʼ\s-]/g, '');
  if (cleaned !== name.value) {
    name.value = cleaned;
    setFieldError(name, 'Дозволені лише літери, апостроф і дефіс');
  } else if (name.closest('.field').classList.contains('field--error')) {
    setFieldError(name, fullNameError(name.value)); // знімаємо помилку, щойно стало правильно
  }
});

validateOnBlur(name, fullNameError, { onValid: () => (name.value = capitalizeName(name.value)) });

// Телефон: лише цифри, автоформат «67 123 45 67», підтримка вставки «+38 (067) 123-45-67»
phone.addEventListener('input', () => {
  phone.value = formatPhoneInput(phoneDigits(phone.value));
  if (phone.closest('.field').classList.contains('field--error')) setFieldError(phone, phoneError(phone.value));
});
validateOnBlur(phone, phoneError);

// Підказки до пароля в реальному часі
password.addEventListener('input', () => {
  const problems = passwordProblems(password.value);
  rules.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('is-ok', !problems.includes(li.dataset.rule));
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  let ok = true;
  const fail = (input, msg) => (setFieldError(input, msg), (ok = false));

  const nameError = fullNameError(name.value);
  if (nameError) fail(name, nameError);
  else name.value = capitalizeName(name.value);
  if (!google && !isEmail(email.value)) fail(email, 'Введіть коректний email');
  const phoneErr = phoneError(phone.value);
  if (phoneErr) fail(phone, phoneErr);
  const compErr = company.error();
  if (compErr) fail(company.input, compErr);
  if (!google) {
    const problems = passwordProblems(password.value);
    if (problems.length) fail(password, 'Пароль не відповідає вимогам');
    if (confirm.value !== password.value) fail(confirm, 'Паролі не збігаються');
  }
  if (!terms.checked) fail(terms, 'Потрібна згода на обробку даних');
  if (!ok) return;

  const companyValue = isOwner ? { ...company.value(), city: form.elements.companyCity.value.trim() || null } : company.value();
  const e164 = toE164(phoneDigits(phone.value));
  try {
    if (google) {
      // через Google: пошта вже підтверджена — одразу SMS-код на телефон
      const res = await withLoading(form.querySelector('[type=submit]'), () =>
        registerWithGoogle({ credential: google.credential, name: name.value.trim(), phone: e164, company: companyValue })
      );
      const mail = res?.email ?? google.profile.email;
      rememberEmail(mail);
      sessionStorage.setItem('pendingPhone', res?.phone ?? e164);
      sessionStorage.setItem('pendingEmail', mail);
      location.href = `/pages/verify-phone.html?mode=social&email=${encodeURIComponent(mail)}`;
      return;
    }
    const cleanEmail = email.value.trim().toLowerCase();
    await withLoading(form.querySelector('[type=submit]'), () =>
      register({ name: name.value.trim(), email: cleanEmail, phone: e164, password: password.value, company: companyValue })
    );
    rememberEmail(cleanEmail);
    location.href = `/pages/verify-email.html?email=${encodeURIComponent(cleanEmail)}`;
  } catch (err) {
    if (err.code === 'company_not_found') setFieldError(company.input, err.message);
    else if (err.code === 'phone_taken') setFieldError(phone, 'Цей номер уже зареєстровано');
    else if (err.status === 409) google ? showAlert(form, err.message) : setFieldError(email, 'Цей email уже зареєстровано');
    else showAlert(form, err.message);
  }
});

// ---------- Реєстрація через Google ----------
// Ім'я, пошту й фото беремо з акаунта Google — людині лишається вказати компанію й телефон
let google = null; // { credential, profile }
const initials = (str) => str.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const chip = document.getElementById('googleChip');
const passwordBlock = document.getElementById('passwordBlock');
const socialParts = form.querySelectorAll('[data-social]');

function useGoogle(credential) {
  const profile = googleProfile(credential);
  if (!profile?.email) return showAlert(form, 'Не вдалося отримати дані з Google. Спробуйте ще раз');
  google = { credential, profile };
  clearErrors(form);
  name.value = capitalizeName(profile.name || '');
  email.value = profile.email;
  email.readOnly = true;
  passwordBlock.hidden = true;
  socialParts.forEach((el) => (el.hidden = true));
  document.getElementById('googleAvatar').innerHTML = profile.picture
    ? `<img src="${escapeHtml(profile.picture)}" alt="" referrerpolicy="no-referrer" />`
    : escapeHtml(initials(profile.name || profile.email));
  document.getElementById('googleName').textContent = profile.name || profile.email;
  document.getElementById('googleEmail').textContent = profile.email;
  chip.hidden = false;
  // курсор — у перше незаповнене поле
  const firstEmpty = [company.input, isOwner && form.elements.companyCity, name, phone].find((el) => el && !el.value.trim());
  firstEmpty?.focus();
}

document.getElementById('googleReset').addEventListener('click', () => {
  google = null;
  chip.hidden = true;
  passwordBlock.hidden = false;
  socialParts.forEach((el) => (el.hidden = false));
  email.readOnly = false;
  email.value = '';
  name.value = '';
  clearErrors(form);
  name.focus();
});

initGoogleButton({
  text: 'signup_with',
  mockRole: () => (isOwner ? 'owner' : 'manager'),
  onCredential: useGoogle,
  onError: (msg) => showAlert(form, msg),
});

// Прийшли зі сторінки входу через Google, а акаунта ще немає — дані вже є
const stashed = takeGoogleCredential();
if (stashed) useGoogle(stashed);

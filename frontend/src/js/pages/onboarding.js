// «Завершіть реєстрацію»: сюди потрапляє новий користувач після входу через Google/Facebook.
// Соцмережа дає лише ім'я та пошту, тож тут вказуємо компанію й телефон → SMS-код → робочий простір.
import { initAuthPage } from '../utils/auth-page.js';
import { initCompanyField } from '../utils/company-field.js';
import { getCurrentUser, isLoggedIn, nextPageFor, completeSignup, logout } from '../api/auth.js';
import { fullNameError, capitalizeName, phoneDigits, formatPhoneInput, phoneError, toE164, setFieldError, validateOnBlur, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage({ redirectIfLoggedIn: false });

const user = getCurrentUser();
// Без входу тут нічого робити; якщо компанія вже є — далі по ланцюжку (SMS або робочий простір)
if (!isLoggedIn() || !user) location.replace('/pages/login.html');
else if (user.companyId) location.replace(nextPageFor(user));

const form = document.getElementById('onboardingForm');
const { name, phone, terms } = form.elements;
const company = initCompanyField(form);

document.getElementById('obEmail').textContent = user?.email ?? '';
// Ім'я з Google підставляємо, але даємо виправити (Google може дати одне слово чи псевдонім)
name.value = user?.name ?? '';
if (user?.phone) phone.value = formatPhoneInput(phoneDigits(user.phone));

validateOnBlur(name, fullNameError, { onValid: () => (name.value = capitalizeName(name.value)) });
phone.addEventListener('input', () => {
  phone.value = formatPhoneInput(phoneDigits(phone.value));
  if (phone.closest('.field').classList.contains('field--error')) setFieldError(phone, phoneError(phone.value));
});
validateOnBlur(phone, phoneError);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  let ok = true;
  const fail = (input, msg) => (setFieldError(input, msg), (ok = false));

  const nameErr = fullNameError(name.value);
  if (nameErr) fail(name, nameErr);
  else name.value = capitalizeName(name.value);
  const compErr = company.error();
  if (compErr) fail(company.input, compErr);
  const phoneErr = phoneError(phone.value);
  if (phoneErr) fail(phone, phoneErr);
  if (!terms.checked) fail(terms, 'Потрібна згода на обробку даних');
  if (!ok) return;

  try {
    const e164 = toE164(phoneDigits(phone.value));
    const updated = await withLoading(form.querySelector('[type=submit]'), () =>
      completeSignup({ name: name.value.trim(), phone: e164, company: company.value() })
    );
    sessionStorage.setItem('pendingPhone', e164);
    sessionStorage.setItem('pendingEmail', updated.email);
    location.replace(`/pages/verify-phone.html?mode=social&email=${encodeURIComponent(updated.email)}`);
  } catch (err) {
    if (err.code === 'company_not_found') setFieldError(company.input, err.message);
    else if (err.code === 'phone_taken') setFieldError(phone, 'Цей номер уже використовується');
    else showAlert(form, err.message);
  }
});

document.getElementById('obLogout').addEventListener('click', logout);

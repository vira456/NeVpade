import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { register, nextPageFor } from '../api/auth.js';
import { initSocialButtons } from '../utils/social.js';
import { isEmail, fullNameError, capitalizeName, phoneDigits, formatPhoneInput, phoneError, toE164, passwordProblems, setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('registerForm');
const { name, email, phone, password, confirm, terms } = form.elements;
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

name.addEventListener('blur', () => {
  if (!name.value.trim()) return;
  const error = fullNameError(name.value);
  if (!error) name.value = capitalizeName(name.value);
  setFieldError(name, error);
});

// Телефон: лише цифри, автоформат «67 123 45 67», підтримка вставки «+38 (067) 123-45-67»
phone.addEventListener('input', () => {
  phone.value = formatPhoneInput(phoneDigits(phone.value));
  if (phone.closest('.field').classList.contains('field--error')) setFieldError(phone, phoneError(phone.value));
});
phone.addEventListener('blur', () => {
  if (phone.value) setFieldError(phone, phoneError(phone.value));
});

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
  if (!isEmail(email.value)) fail(email, 'Введіть коректний email');
  const phoneErr = phoneError(phone.value);
  if (phoneErr) fail(phone, phoneErr);
  const problems = passwordProblems(password.value);
  if (problems.length) fail(password, `Пароль має містити: ${problems.join(', ')}`);
  if (confirm.value !== password.value) fail(confirm, 'Паролі не збігаються');
  if (!terms.checked) fail(terms, 'Потрібна згода на обробку даних');
  if (!ok) return;

  try {
    const cleanEmail = email.value.trim().toLowerCase();
    await withLoading(form.querySelector('[type=submit]'), () =>
      register({ name: name.value.trim(), email: cleanEmail, phone: toE164(phoneDigits(phone.value)), password: password.value })
    );
    rememberEmail(cleanEmail);
    location.href = `/pages/verify-email.html?email=${encodeURIComponent(cleanEmail)}`;
  } catch (err) {
    if (err.code === 'phone_taken') setFieldError(phone, 'Цей номер уже використовується');
    else if (err.status === 409) setFieldError(email, 'Користувач з таким email вже існує');
    else showAlert(form, err.message);
  }
});

initSocialButtons({ onSuccess: (user) => location.replace(nextPageFor(user)), onError: (msg) => showAlert(form, msg) });

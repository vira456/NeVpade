import { initAuthPage, recallEmail, initCodeInputs, startCooldown } from '../utils/auth-page.js';
import { verifyPhone, addPhone, resendCode, getCurrentUser, logout } from '../api/auth.js';
import { phoneDigits, formatPhoneInput, phoneError, toE164, maskPhone, setFieldError, showAlert, clearErrors, withLoading } from '../utils/validation.js';

// Користувач після Google/Facebook вже має токен, тож не перенаправляємо його на головну
initAuthPage({ redirectIfLoggedIn: false });

const params = new URLSearchParams(location.search);
const addMode = params.get('mode') === 'add'; // вхід через соцмережу: номер ще не вказано
const email = recallEmail() || getCurrentUser()?.email;
let phone = sessionStorage.getItem('pendingPhone');

const phoneForm = document.getElementById('phoneForm');
const codeForm = document.getElementById('codeForm');
const phoneInput = phoneForm.elements.phone;
const resendBtn = document.getElementById('resendBtn');

if (!email) location.replace('/pages/register.html');
if (addMode) document.getElementById('steps').hidden = true;

const code = initCodeInputs(document.getElementById('codeInputs'), () => codeForm.requestSubmit());

function showPhoneStep() {
  codeForm.hidden = true;
  phoneForm.hidden = false;
  if (phone) phoneInput.value = formatPhoneInput(phoneDigits(phone));
  phoneInput.focus();
}

function showCodeStep() {
  phoneForm.hidden = true;
  codeForm.hidden = false;
  document.getElementById('phoneLabel').textContent = maskPhone(phone);
  code.clear();
  startCooldown(resendBtn);
}

// ----- Введення / зміна номера -----
phoneInput.addEventListener('input', () => {
  phoneInput.value = formatPhoneInput(phoneDigits(phoneInput.value));
  if (phoneInput.closest('.field').classList.contains('field--error')) setFieldError(phoneInput, phoneError(phoneInput.value));
});

phoneForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(phoneForm);
  const err = phoneError(phoneInput.value);
  if (err) return setFieldError(phoneInput, err);

  try {
    const newPhone = toE164(phoneDigits(phoneInput.value));
    await withLoading(phoneForm.querySelector('[type=submit]'), () => addPhone(email, newPhone));
    phone = newPhone;
    sessionStorage.setItem('pendingPhone', phone);
    showCodeStep();
  } catch (error) {
    if (error.code === 'phone_taken') setFieldError(phoneInput, 'Цей номер уже використовується');
    else showAlert(phoneForm, error.message);
  }
});

// ----- Код з SMS -----
codeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(codeForm);
  code.setError(false);

  if (code.value().length !== 6) {
    code.setError(true);
    return showAlert(codeForm, 'Введіть усі 6 цифр коду');
  }

  try {
    await withLoading(codeForm.querySelector('[type=submit]'), () => verifyPhone(email, code.value()));
    ['pendingEmail', 'pendingPhone', 'mockName', 'mockPhone'].forEach((k) => sessionStorage.removeItem(k));
    location.replace('/index.html');
  } catch (err) {
    code.setError(true);
    code.clear();
    showAlert(codeForm, err.message);
  }
});

resendBtn.addEventListener('click', async () => {
  clearErrors(codeForm);
  try {
    await resendCode(email, 'verify_phone');
    showAlert(codeForm, 'Нове SMS надіслано', 'success');
    startCooldown(resendBtn);
  } catch (err) {
    showAlert(codeForm, err.message);
  }
});

document.getElementById('changePhoneBtn').addEventListener('click', showPhoneStep);

// ----- Старт -----
if (addMode || !phone) showPhoneStep();
else showCodeStep();

// Для соцмереж даємо можливість вийти, якщо користувач передумав
if (addMode) {
  const row = document.createElement('p');
  row.className = 'auth__footer';
  row.innerHTML = '<button class="btn--link" type="button">Вийти з акаунта</button>';
  row.querySelector('button').addEventListener('click', logout);
  codeForm.after(row);
}

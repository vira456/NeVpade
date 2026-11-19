// «Чекаємо підтвердження власника»: менеджер зареєструвався з кодом запрошення,
// а власник ще не прийняв заявку (або відхилив — тоді можна надіслати нову з іншим кодом)
import { initAuthPage } from '../utils/auth-page.js';
import { isLoggedIn, getCurrentUser, nextPageFor, refreshSession, requestJoin, logout, PENDING_PAGE } from '../api/auth.js';
import { icons } from '../utils/icons.js';
import { setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';
import { locale, t } from '../i18n/index.js';

initAuthPage({ redirectIfLoggedIn: false });

const $ = (id) => document.getElementById(id);
const POLL_MS = 15000;
let timer = null;

if (!isLoggedIn()) location.replace('/pages/login.html');

function goOnIfReady(user) {
  const next = nextPageFor(user);
  if (next !== PENDING_PAGE) {
    location.replace(next); // прийняли — у робочий простір; прибрали з компанії — на «Завершіть реєстрацію»
    return true;
  }
  return false;
}

function render(user) {
  const rejected = user?.memberStatus === 'rejected';
  $('pendingIcon').innerHTML = rejected ? icons.close : icons.users;
  $('pendingIcon').classList.toggle('is-bad', rejected);
  $('pendingTitle').textContent = t(rejected ? 'Власник відхилив заявку' : 'Чекаємо підтвердження власника');
  $('pendingText').textContent = rejected
    ? t('Заявку до компанії {company} не прийнято. Можливо, код запрошення вже змінився — уточніть його у власника й надішліть заявку ще раз.', { company: user?.companyName ?? '' })
    : t('Ви надіслали заявку на вступ до компанії {company}. Щойно власник компанії її прийме, відкриється робочий простір — ця сторінка перевіряє це сама.', { company: user?.companyName ?? '' });
  $('pendingWait').hidden = rejected;
  $('retryForm').hidden = !rejected;
}

async function check({ manual = false } = {}) {
  const res = await refreshSession();
  const user = res?.user ?? getCurrentUser();
  if (goOnIfReady(user)) return;
  render(user);
  $('pendingChecked').textContent = t('Перевірено о {time}', { time: new Date().toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  if (manual && user?.memberStatus === 'pending') $('pendingChecked').textContent += ` · ${t('заявка ще чекає')}`;
}

function schedule() {
  clearInterval(timer);
  timer = setInterval(() => document.visibilityState === 'visible' && check(), POLL_MS);
}

$('pendingCheck').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await check({ manual: true });
  } finally {
    btn.disabled = false;
  }
});
$('pendingLogout').addEventListener('click', logout);
$('retryLogout').addEventListener('click', logout);

// Код у форматі NVP-1234: великі літери й дефіс підставляються самі
const code = $('retryCode');
code.addEventListener('input', () => {
  const raw = code.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  code.value = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3, 7)}` : raw;
});
$('retryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  clearErrors(form);
  if (!/^[A-Z]{3}-\d{4}$/.test(code.value)) return setFieldError(code, 'Введіть код запрошення у форматі NVP-1234');
  try {
    const user = await withLoading($('retrySubmit'), () => requestJoin(code.value));
    render(user);
  } catch (err) {
    if (err.code === 'company_not_found') setFieldError(code, err.message);
    else showAlert(form, err.message);
  }
});

const user = getCurrentUser();
if (user && !goOnIfReady(user)) {
  render(user);
  check();
  schedule();
}

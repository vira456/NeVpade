// Вкладка «Особисті дані»: KPI-картки та форма редагування
import { getKpi, updateProfile } from '../../api/profile.js';
import { renderSidebarUser } from '../../utils/layout.js';
import { getLang, setLang } from '../../utils/prefs.js';
import { countUp } from '../../utils/motion.js';
import { t, locale } from '../../i18n/index.js';
import { showToast } from '../../utils/toast.js';
import {
  isEmail,
  fullNameError,
  capitalizeName,
  phoneDigits,
  formatPhoneInput,
  phoneError,
  toE164,
  setFieldError,
  validateOnBlur,
  clearErrors,
  withLoading,
} from '../../utils/validation.js';

const form = document.getElementById('personalForm');
const { fullName, email, phone, language } = form.elements;
const saveBtn = document.getElementById('personalSave');
const resetBtn = document.getElementById('personalReset');

let saved = null; // останній збережений профіль

const NAME_OPTS = { maxWords: 3 };

// Значення форми у тому вигляді, як їх відправляємо на сервер
const formValues = () => ({
  fullName: capitalizeName(fullName.value),
  email: email.value.trim().toLowerCase(),
  phone: toE164(phoneDigits(phone.value)),
  language: language.value,
});

const isDirty = () => saved && JSON.stringify(formValues()) !== JSON.stringify(pick(saved));
const pick = (p) => ({ fullName: p.fullName, email: p.email, phone: p.phone, language: p.language });

function updateButtons() {
  const dirty = isDirty();
  saveBtn.disabled = !dirty;
  resetBtn.hidden = !dirty;
}

function fill(profile) {
  fullName.value = profile.fullName;
  email.value = profile.email;
  phone.value = formatPhoneInput(phoneDigits(profile.phone));
  language.value = profile.language ?? getLang();
  clearErrors(form);
  updateButtons();
}

function validate() {
  clearErrors(form);
  const errors = [
    [fullName, fullNameError(fullName.value, NAME_OPTS)],
    [email, isEmail(email.value) ? '' : 'Введіть коректний email'],
    [phone, phoneError(phone.value)],
  ];
  errors.forEach(([input, msg]) => setFieldError(input, msg));
  const firstBad = errors.find(([, msg]) => msg);
  firstBad?.[0].focus();
  return !firstBad;
}

export async function renderKpi() {
  const kpi = await getKpi();
  document.getElementById('kpiTrips').textContent = kpi.tripsCount.toLocaleString(locale());
  document.getElementById('kpiTripsNote').textContent = t('за весь час · {n} цього місяця', { n: kpi.tripsThisMonth });
  // частка рейсів, які клієнт оплатив не пізніше терміну
  document.getElementById('kpiRating').innerHTML = kpi.paidOnTime === null ? '—' : `${kpi.paidOnTime}<small>%</small>`;
  document.getElementById('kpiRatingBar').style.width = `${kpi.paidOnTime ?? 0}%`;
  document.getElementById('kpiDrivers').textContent = kpi.activeDrivers;
  ['kpiTrips', 'kpiDrivers'].forEach((id) => countUp(document.getElementById(id)));
}

/**
 * @param {object} profile
 * @param {(profile) => void} onSaved
 */
export function initPersonal(profile, onSaved) {
  profile.language = getLang(); // джерело правди — поточна мова інтерфейсу (її змінюють і в боковій панелі)
  saved = profile;
  fill(profile);

  form.addEventListener('input', updateButtons);

  phone.addEventListener('input', () => {
    phone.value = formatPhoneInput(phoneDigits(phone.value));
  });

  // Перевірка при виході з поля
  validateOnBlur(fullName, (v) => fullNameError(v, NAME_OPTS));
  validateOnBlur(email, (v) => (isEmail(v) ? '' : 'Введіть коректний email'));
  validateOnBlur(phone, phoneError);

  resetBtn.addEventListener('click', () => fill(saved));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return showToast('Перевірте виділені поля', 'error');

    try {
      const values = formValues();
      saved = await withLoading(saveBtn, () => updateProfile(values));
      fill(saved);
      renderSidebarUser();
      onSaved(saved);
      showToast('Зміни збережено');
      // Мова з профілю = мова інтерфейсу (сторінка перезавантажиться вже потрібною мовою)
      if (saved.language !== getLang()) setTimeout(() => setLang(saved.language), 600);
    } catch (err) {
      if (err.code === 'email_taken') setFieldError(email, 'Цей email уже використовується');
      else if (err.code === 'phone_taken') setFieldError(phone, 'Цей номер уже використовується');
      showToast(err.message, 'error');
    } finally {
      updateButtons();
    }
  });

  // Попередження про незбережені зміни при закритті сторінки
  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
}

// Профіль змінився з іншого місця (напр. нове фото) — оновлюємо «збережену» копію
export function setSavedProfile(profile) {
  saved = profile;
}

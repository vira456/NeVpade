// Вкладка «Безпека»: зміна пароля та інформація про активну сесію
import { changePassword } from '../../api/profile.js';
import { getLoginTime, logout } from '../../api/auth.js';
import { showToast } from '../../utils/toast.js';
import { detectBrowser, detectOS, deviceType, formatDuration } from '../../utils/device.js';
import { passwordProblems, setFieldError, clearErrors, withLoading } from '../../utils/validation.js';

const form = document.getElementById('passwordForm');
const { current, password, confirm } = form.elements;
const meter = document.getElementById('strengthMeter');
const meterLabel = document.getElementById('strengthLabel');

// 0–4: довжина, різні регістри, цифри, спецсимволи
function strength(p) {
  if (!p) return 0;
  let score = 0;
  if (p.length >= 8) score++;
  if (p.length >= 12) score++;
  if (/[a-zа-яіїєґ]/.test(p) && /[A-ZА-ЯІЇЄҐ]/.test(p)) score++;
  if (/\d/.test(p) && /[^\p{L}\d]/u.test(p)) score++;
  return passwordProblems(p).length ? 1 : Math.max(score, 2); // не виконано вимоги — завжди «Слабкий»
}

const LEVELS = ['', 'Слабкий', 'Середній', 'Добрий', 'Надійний'];

function updateStrength() {
  const s = strength(password.value);
  meter.dataset.level = s;
  meterLabel.textContent = password.value ? LEVELS[s] : '';

  const problems = passwordProblems(password.value);
  document.querySelectorAll('#securityRules li').forEach((li) => {
    li.classList.toggle('is-ok', Boolean(password.value) && !problems.includes(li.dataset.rule));
  });
}

function validate() {
  clearErrors(form);
  const problems = passwordProblems(password.value);
  const errors = [
    [current, current.value ? '' : 'Введіть поточний пароль'],
    [
      password,
      !password.value
        ? 'Введіть новий пароль'
        : problems.length
          ? `Пароль має містити: ${problems.join(', ')}`
          : password.value === current.value
            ? 'Новий пароль має відрізнятися від поточного'
            : '',
    ],
    [confirm, confirm.value === password.value ? '' : 'Паролі не збігаються'],
  ];
  errors.forEach(([input, msg]) => setFieldError(input, msg));
  const firstBad = errors.find(([, msg]) => msg);
  firstBad?.[0].focus();
  return !firstBad;
}

function initPasswordForm() {
  // Показати/сховати пароль
  form.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Сховати' : 'Показати';
    });
  });

  password.addEventListener('input', updateStrength);
  confirm.addEventListener('input', () => {
    if (confirm.closest('.field').classList.contains('field--error')) {
      setFieldError(confirm, confirm.value === password.value ? '' : 'Паролі не збігаються');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!validate()) return;
    try {
      await withLoading(form.querySelector('[type=submit]'), () => changePassword(current.value, password.value));
      form.reset();
      updateStrength();
      showToast('Пароль успішно змінено');
    } catch (err) {
      if (err.code === 'invalid_password') {
        setFieldError(current, err.message);
        current.focus();
      } else {
        showToast(err.message, 'error');
      }
    }
  });
}

function renderSession() {
  const loginAt = new Date(getLoginTime() || Date.now());
  const set = (id, text) => (document.getElementById(id).textContent = text);

  set('sessionBrowser', detectBrowser());
  set('sessionOS', `${detectOS()} · ${deviceType()}`);
  set(
    'sessionLogin',
    loginAt.toLocaleString('uk-UA', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  );

  const tick = () => set('sessionDuration', formatDuration(Date.now() - loginAt.getTime()));
  tick();
  setInterval(tick, 30000);

  document.getElementById('sessionLogout').addEventListener('click', logout);
}

export function initSecurity() {
  initPasswordForm();
  renderSession();
}

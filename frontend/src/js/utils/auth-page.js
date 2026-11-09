// Спільне для сторінок входу/реєстрації
import '../../scss/main.scss';
import { isMockMode } from '../api/client.js';
import { isLoggedIn } from '../api/auth.js';

export function initAuthPage({ redirectIfLoggedIn = true } = {}) {
  if (redirectIfLoggedIn && isLoggedIn()) location.replace('/index.html');

  // Показати/сховати пароль
  document.querySelectorAll('[data-toggle-password]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.togglePassword);
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.textContent = show ? 'Сховати' : 'Показати';
    });
  });

  if (isMockMode) document.querySelectorAll('[data-mock-only]').forEach((el) => (el.hidden = false));
}

// Email передаємо між сторінками через sessionStorage + параметр URL
export function rememberEmail(email) {
  sessionStorage.setItem('pendingEmail', email);
}

export function recallEmail() {
  return new URLSearchParams(location.search).get('email') || sessionStorage.getItem('pendingEmail') || '';
}

// Зворотний відлік для кнопки «Надіслати код ще раз»
export function startCooldown(button, seconds = 60) {
  const label = button.dataset.label || button.textContent;
  button.dataset.label = label;
  button.disabled = true;
  let left = seconds;
  button.textContent = `${label} (${left} с)`;
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(timer);
      button.disabled = false;
      button.textContent = label;
    } else {
      button.textContent = `${label} (${left} с)`;
    }
  }, 1000);
}

// 6 окремих полів для коду: автоперехід, Backspace, вставка з буфера
export function initCodeInputs(container, onComplete) {
  const inputs = [...container.querySelectorAll('input')];
  const value = () => inputs.map((i) => i.value).join('');

  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(-1);
      if (input.value && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (value().length === inputs.length) onComplete?.(value());
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !input.value && idx > 0) inputs[idx - 1].focus();
      if (e.key === 'ArrowLeft' && idx > 0) inputs[idx - 1].focus();
      if (e.key === 'ArrowRight' && idx < inputs.length - 1) inputs[idx + 1].focus();
    });
    input.addEventListener('paste', (e) => {
      e.preventDefault();
      const digits = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, inputs.length);
      digits.split('').forEach((d, i) => (inputs[i].value = d));
      inputs[Math.min(digits.length, inputs.length - 1)].focus();
      if (digits.length === inputs.length) onComplete?.(value());
    });
  });

  return {
    value,
    clear() {
      inputs.forEach((i) => (i.value = ''));
      inputs[0].focus();
    },
    setError(on) {
      container.classList.toggle('code--error', on);
    },
  };
}

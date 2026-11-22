// Поле «Компанія»: на register-owner.html власник вводить назву нової компанії, усюди інше
// (register.html, «Завершіть реєстрацію», «Змінити компанію» на сторінці «Команда») менеджер вводить код компанії
import { setFieldError } from './validation.js';
import { formatCompanyCode, isCompanyCode } from '../api/auth.js';

export function initCompanyField(form, { onChange } = {}) {
  const { companyName, inviteCode } = form.elements;
  const field = form.querySelector('.company-field');
  const mode = () => form.elements.companyMode.value;

  function sync() {
    const join = mode() === 'join';
    field.querySelector('.company-field__create').hidden = join;
    field.querySelector('.company-field__join').hidden = !join;
    field.querySelectorAll('.seg__btn, .role-card').forEach((l) => l.classList.toggle('is-checked', l.querySelector('input').checked));
    field.querySelectorAll('.seg__btn').forEach((l) => l.setAttribute('aria-pressed', String(l.querySelector('input').checked)));
    onChange?.(mode());
    setFieldError(companyName, '');
  }
  form.querySelectorAll('[name=companyMode]').forEach((r) => r.addEventListener('change', sync));
  sync();
  form.addEventListener('reset', () => setTimeout(sync));

  // Код у форматі NVP-1234: великі літери й дефіс підставляються самі
  inviteCode.addEventListener('input', () => (inviteCode.value = formatCompanyCode(inviteCode.value)));

  return {
    input: companyName, // сюди показуємо помилку
    error() {
      if (mode() === 'join') return isCompanyCode(inviteCode.value) ? '' : 'Введіть код компанії у форматі NVP-1234';
      return companyName.value.trim().length < 2 ? 'Вкажіть назву компанії (мінімум 2 символи)' : '';
    },
    value: () =>
      mode() === 'join'
        ? { mode: 'join', code: inviteCode.value }
        : { mode: 'create', name: companyName.value.trim().replace(/\s+/g, ' ') },
  };
}

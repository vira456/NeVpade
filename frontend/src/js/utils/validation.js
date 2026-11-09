export const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

// Повертає список невиконаних вимог до пароля (порожній — пароль ок)
export function passwordProblems(p) {
  const problems = [];
  if (p.length < 8) problems.push('щонайменше 8 символів');
  if (!/[A-Za-zА-Яа-яІіЇїЄєҐґ]/.test(p)) problems.push('хоча б одна літера');
  if (!/\d/.test(p)) problems.push('хоча б одна цифра');
  return problems;
}

// Показ/приховування помилки під полем
export function setFieldError(input, message) {
  const field = input.closest('.field');
  field?.classList.toggle('field--error', Boolean(message));
  const hint = field?.querySelector('.field__error');
  if (hint) hint.textContent = message || '';
}

export function clearErrors(form) {
  form.querySelectorAll('.field').forEach((f) => f.classList.remove('field--error'));
  form.querySelectorAll('.field__error').forEach((e) => (e.textContent = ''));
  const alert = form.querySelector('.auth__alert');
  if (alert) alert.hidden = true;
}

export function showAlert(form, message, type = 'error') {
  const alert = form.querySelector('.auth__alert');
  if (!alert) return;
  alert.textContent = message;
  alert.className = `auth__alert auth__alert--${type}`;
  alert.hidden = false;
}

// Блокує кнопку на час запиту
export async function withLoading(button, fn) {
  const text = button.textContent;
  button.disabled = true;
  button.textContent = 'Зачекайте…';
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.textContent = text;
  }
}

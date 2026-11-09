// ---------- Ім'я та прізвище ----------
// Дозволено: українські та латинські літери, апостроф (', ’, ʼ) і дефіс усередині слова.
// Приклади: «Мар'яна Коваль», «Олена Петренко-Сидоренко», «Anna Smith»
const LETTERS = "A-Za-zА-ЩЬЮЯҐЄІЇа-щьюяґєії";
const NAME_WORD = new RegExp(`^[${LETTERS}]+(?:['’ʼ-][${LETTERS}]+)*$`);
const ALLOWED_CHARS = new RegExp(`^[${LETTERS}'’ʼ\\s-]*$`);

// Прибирає зайві пробіли на початку, в кінці та між словами
export const normalizeName = (v) => v.trim().replace(/\s+/g, ' ');

// Повертає текст помилки або '' якщо все добре
export function fullNameError(value) {
  const name = normalizeName(value);
  if (!name) return "Введіть ім'я та прізвище";
  if (!ALLOWED_CHARS.test(name)) return "Дозволені лише літери, апостроф і дефіс (без цифр і символів)";

  const words = name.split(' ');
  if (words.length < 2) return "Введіть ім'я та прізвище через пробіл";
  if (words.length > 2) return "Введіть лише два слова: ім'я та прізвище";
  if (words.some((w) => !NAME_WORD.test(w))) return 'Апостроф і дефіс можуть стояти лише всередині слова';
  if (words.some((w) => w.replace(/['’ʼ-]/g, '').length < 2)) return 'Кожне слово має містити щонайменше 2 літери';
  if (name.length > 60) return 'Задовге значення (максимум 60 символів)';
  return '';
}

// «олена коваль» → «Олена Коваль», «петренко-сидоренко» → «Петренко-Сидоренко»
export const capitalizeName = (v) =>
  normalizeName(v)
    .toLowerCase()
    .replace(/(^|[\s-])([^\s-])/g, (_, sep, ch) => sep + ch.toUpperCase());

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

// ---------- Телефон (Україна, мобільні) ----------
// Коди мобільних операторів: Київстар, Vodafone, lifecell, 3Mob, Інтертелеком тощо
const MOBILE_CODES = ['39', '50', '63', '66', '67', '68', '73', '89', '91', '92', '93', '94', '95', '96', '97', '98', '99'];

// Витягує 9 цифр після +380 з будь-якого запису: «+38 (067) 123-45-67», «0671234567», «671234567»
export function phoneDigits(value) {
  let d = String(value).replace(/\D/g, '');
  if (d.startsWith('380')) d = d.slice(3);
  else if (d.startsWith('80') && d.length === 11) d = d.slice(2);
  if (d.startsWith('0')) d = d.slice(1); // поле вже має префікс +380, тож «067…» → «67…»
  return d.slice(0, 9);
}

// «671234567» → «67 123 45 67» (для поля вводу)
export function formatPhoneInput(digits) {
  const parts = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)];
  return parts.filter(Boolean).join(' ');
}

// «671234567» → «+380671234567» (формат E.164, саме так відправляємо на сервер)
export const toE164 = (digits) => `+380${digits}`;

// «+380671234567» → «+380 67 *** ** 67» (показуємо, куди надіслано SMS)
export const maskPhone = (e164) => {
  const d = phoneDigits(e164);
  return d.length === 9 ? `+380 ${d.slice(0, 2)} *** ** ${d.slice(7)}` : e164;
};

export function phoneError(value) {
  const d = phoneDigits(value);
  if (!d) return 'Введіть номер телефону';
  if (d.length < 9) return 'Номер має містити 9 цифр після +380';
  if (!MOBILE_CODES.includes(d.slice(0, 2))) return `Невідомий код оператора «0${d.slice(0, 2)}». Вкажіть мобільний номер`;
  return '';
}

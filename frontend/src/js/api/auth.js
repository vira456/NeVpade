// Вхід, реєстрація, сесія й ролі. Відповіді в режимі моків — mock/auth.js.
import { request } from './client.js';

/**
 * Дві окремі ролі з різними інтерфейсами:
 *  owner   — власник компанії: кабінет власника (огляд, менеджери, фінанси, компанія); входить поштою й паролем
 *  manager — менеджер: рейси, клієнти, автопарк, графік, завдання, чат; при кожному вході вводить
 *            код компанії, який бачить лише власник (той самий, що й при реєстрації)
 */
export const OWNER_HOME = '/pages/owner.html';
export const MANAGER_HOME = '/pages/dashboard.html';
export const PENDING_PAGE = '/pages/pending.html';

/** Роль користувача: owner або manager (якщо сервер роль не віддав — manager) */
export const roleOf = (user) => user?.role || 'manager';
export const homeFor = (user) => (roleOf(user) === 'owner' ? OWNER_HOME : MANAGER_HOME);

// ---------- Код компанії ----------
// Формат NVP-1234. Його бачить лише власник (кабінет → «Менеджери»); менеджер вводить код
// під час реєстрації і при кожному вході. Власник змінив код — менеджери входять уже з новим.
export function formatCompanyCode(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  return s.length > 3 ? `${s.slice(0, 3)}-${s.slice(3)}` : s;
}
export const isCompanyCode = (code) => /^[A-Z]{3}-\d{4}$/.test(code);

// ---------- Сесія ----------
export function saveSession({ token, user }) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('loginAt', new Date().toISOString()); // для блоку «Активна сесія»
}

export const getLoginTime = () => localStorage.getItem('loginAt');

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export const isLoggedIn = () => Boolean(localStorage.getItem('token'));

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('loginAt');
  localStorage.removeItem('nevpade.sidebarSnapshot'); // у меню ім'я й компанія — не лишаємо після виходу
  location.href = '/pages/login.html';
}

// ---------- Вхід / реєстрація ----------
/**
 * Вхід. role — вкладка, яку обрав користувач: 'manager' або 'owner'.
 * Менеджер додатково вводить код компанії (companyCode), який дає йому власник: без нього в робочий простір
 * не зайти, навіть знаючи пароль, а власник може закрити доступ усім, просто змінивши код.
 * Власник входить поштою й паролем або через Google.
 * Помилки: 401 invalid_credentials, 401 invalid_company_code, 403 wrong_role (не та вкладка), 429 too_many_attempts
 */
export async function login(email, password, { role = 'manager', companyCode } = {}) {
  const data = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password, role, ...(role === 'manager' && { companyCode }) },
    mock: (m) => m.auth.login({ email, password, role, companyCode }),
  });
  saveSession(data);
  return data.user;
}

/**
 * Актуальні дані про себе з сервера (GET /auth/me): роль чи компанію могли змінити,
 * поки користувач був на сайті. Збережені в браузері дані — лише кеш, рішення про доступ приймає сервер.
 */
export const getMe = () =>
  request('/auth/me', {
    mock: (m) => m.auth.currentUser(),
  });

/**
 * Оновити збережену сесію з /auth/me. Повертає { user, changed } або null, якщо сервер
 * ще не має /auth/me чи недоступний (тоді працюємо зі збереженими даними).
 */
export async function refreshSession() {
  const before = getCurrentUser();
  if (!before) return null;
  let fresh;
  try {
    fresh = await getMe();
  } catch {
    return null;
  }
  if (!fresh || typeof fresh !== 'object') return null;
  const user = { ...before, ...fresh, id: String(fresh.id ?? fresh._id ?? before.id) };
  localStorage.setItem('user', JSON.stringify(user));
  return {
    user,
    // порівнюємо те, що реально впливає на доступ (роль «не вказано» = та сама роль, що й з демо-даних)
    changed:
      roleOf(before) !== roleOf(user) ||
      String(before.companyId ?? '') !== String(user.companyId ?? '') ||
      (before.memberStatus ?? 'active') !== (user.memberStatus ?? 'active'),
  };
}

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту, потім телефон.
// Дві сторінки: register-owner.html — власник створює компанію ({ mode: 'create', name, city }),
// register.html — менеджер приєднується за кодом компанії ({ mode: 'join', code }) і чекає підтвердження власника
export const register = ({ name, email, phone, password, company }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, phone, password, company, role: company?.mode === 'create' ? 'owner' : 'manager' },
    mock: (m) => m.auth.register({ name, email, phone, password, company }),
  });

// Крок 1: код з пошти. Токен ще не видається — далі SMS на телефон
// Відповідь: { next: "verify_phone", phone: "+380671234567" }
export const verifyEmail = (email, code) =>
  request('/auth/verify-email', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: (m) => m.auth.verifyEmail(code),
  });

// Крок 2: код з SMS → вхід у систему (менеджеру — заявка власнику на вступ)
export async function verifyPhone(email, code) {
  const data = await request('/auth/verify-phone', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: (m) => m.auth.verifyPhone(email, code),
  });
  saveSession(data);
  return data.user;
}

// Для входу через Google: соцмережа не дає телефон, тому користувач додає його окремо.
// Новий номер (або зміна номера) → SMS з кодом
export const addPhone = (email, phone) =>
  request('/auth/phone', {
    method: 'POST',
    auth: false,
    body: { email, phone },
    mock: (m) => m.auth.addPhone(phone),
  });

// Куди вести користувача після успішної авторизації.
// Новий користувач з Google ще без компанії → «Завершіть реєстрацію» (компанія + телефон),
// компанія є, але телефон не підтверджено → SMS-код, усе є → робочий простір
export function nextPageFor(user) {
  if (!user) return '/pages/login.html';
  if (!user.companyId) return '/pages/onboarding.html';
  // номер уже вказано (на кроці «Завершіть реєстрацію») → одразу поле для коду, інакше — спершу номер
  if (user.phoneVerified === false) return `/pages/verify-phone.html?mode=${user.phone ? 'social' : 'add'}&email=${encodeURIComponent(user.email)}`;
  // менеджер подав заявку з кодом компанії — доки власник не прийме, робочий простір закритий
  if (user.memberStatus && user.memberStatus !== 'active') return PENDING_PAGE;
  return homeFor(user);
}

// Реєстрацію не завершено — внутрішні сторінки ще недоступні
export const signupIncomplete = (user) => nextPageFor(user) !== homeFor(user);

/**
 * Завершити реєстрацію після входу через Google (користувач уже має токен).
 * Через Google реєструються лише менеджери (join за кодом компанії); власник — на сторінці «Реєстрація компанії».
 * Сервер прив'язує компанію, зберігає телефон і шле SMS-код.
 * Відповідь: { user, message } — user уже з companyId, але phoneVerified: false
 */
export async function completeSignup({ name, phone, company }) {
  const data = await request('/auth/complete-signup', {
    method: 'POST',
    body: { name, phone, company },
    mock: (m) => m.auth.completeSignup({ name, phone, company }),
  });
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

// purpose: verify (пошта) | verify_phone (SMS) | reset (відновлення пароля)
export const resendCode = (email, purpose = 'verify') =>
  request('/auth/resend-code', {
    method: 'POST',
    auth: false,
    body: { email, purpose },
    mock: { message: 'Код надіслано повторно' },
  });

/**
 * Нова заявка на вступ (заявку відхилили — менеджер вводить інший код). Потрібен токен.
 * Відповідь: { user } з memberStatus: 'pending'
 */
export async function requestJoin(code) {
  const data = await request('/auth/join-request', {
    method: 'POST',
    body: { code },
    mock: (m) => m.auth.requestJoin(code),
  });
  localStorage.setItem('user', JSON.stringify({ ...getCurrentUser(), ...data.user }));
  return data.user;
}

// ---------- Відновлення пароля ----------
export const forgotPassword = (email) =>
  request('/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: { email },
    mock: { message: 'Якщо такий email зареєстровано, на нього надіслано код' },
  });

export const resetPassword = (email, code, password) =>
  request('/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: { email, code, password },
    mock: (m) => m.auth.resetPassword(code),
  });

// ---------- Соцмережі ----------
// Google: credential — ID-токен від Google Identity Services, бекенд перевіряє його підпис
export async function loginWithGoogle(credential, { companyCode, role = 'manager' } = {}) {
  const data = await request('/auth/google', {
    method: 'POST',
    auth: false,
    body: { credential, role, ...(role === 'manager' && companyCode && { companyCode }) },
    // Новий користувач — без компанії (код введе на «Завершіть реєстрацію»);
    // наявний менеджер, як і при вході паролем, має ввести код компанії
    mock: (m) => m.auth.google({ role, companyCode }),
  });
  saveSession(data);
  return data.user;
}

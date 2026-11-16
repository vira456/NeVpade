import { request, ApiError } from './client.js';

// У режимі моків правильний код підтвердження завжди такий:
export const MOCK_CODE = '123456';

// Код запрошення тестової компанії в режимі моків
export const MOCK_INVITE = 'NVP-4821';
const MOCK_COMPANY = 'ТОВ «Західтранс»';

const mockUser = (email, name = 'Федорова Віра Дмитрівна', phone = '+380671234567', phoneVerified = true) => ({
  id: 'usr_01',
  name,
  email,
  phone,
  phoneVerified,
  role: sessionStorage.getItem('mockRole') || getCurrentUser()?.role || 'owner', // owner — керівник (створив компанію)
  companyId: 'cmp_01',
  companyName: sessionStorage.getItem('mockCompany') || getCurrentUser()?.companyName || MOCK_COMPANY,
});

function checkMockCode(code) {
  if (code !== MOCK_CODE) throw new ApiError('Невірний код підтвердження', 400, 'invalid_code');
}

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
  location.href = '/pages/login.html';
}

// ---------- Вхід / реєстрація ----------
export async function login(email, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password },
    mock: () => ({ token: 'mock-token', user: mockUser(email) }),
  });
  saveSession(data);
  return data.user;
}

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту, потім телефон.
// company: { mode: 'create', name } — нова компанія, або { mode: 'join', code } — за кодом запрошення колеги
export const register = ({ name, email, phone, password, company }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, phone, password, company },
    mock: () => {
      if (company?.mode === 'join' && company.code.toUpperCase() !== MOCK_INVITE) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
      }
      // щоб у моках показати введені дані
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      sessionStorage.setItem('mockCompany', company?.mode === 'create' ? company.name : MOCK_COMPANY);
      sessionStorage.setItem('mockRole', company?.mode === 'create' ? 'owner' : 'manager'); // хто створив компанію — керівник
      return { email, message: 'Код підтвердження надіслано на пошту' };
    },
  });

// Крок 1: код з пошти. Токен ще не видається — далі SMS на телефон
// Відповідь: { next: "verify_phone", phone: "+380671234567" }
export const verifyEmail = (email, code) =>
  request('/auth/verify-email', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      return { next: 'verify_phone', phone: sessionStorage.getItem('mockPhone') || '+380671234567' };
    },
  });

// Крок 2: код з SMS → вхід у систему
export async function verifyPhone(email, code) {
  const data = await request('/auth/verify-phone', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      const phone = sessionStorage.getItem('mockPhone') || undefined;
      const name = sessionStorage.getItem('mockName') || getCurrentUser()?.name || undefined;
      if (getCurrentUser()?.companyId) localStorage.setItem('nevpade.mock.socialDone', '1'); // соцмережа: реєстрацію завершено
      return { token: 'mock-token', user: mockUser(email, name, phone) };
    },
  });
  saveSession(data);
  return data.user;
}

// Для входу через Google/Facebook: соцмережа не дає телефон, тому користувач додає його окремо.
// Новий номер (або зміна номера) → SMS з кодом
export const addPhone = (email, phone) =>
  request('/auth/phone', {
    method: 'POST',
    auth: false,
    body: { email, phone },
    mock: () => {
      sessionStorage.setItem('mockPhone', phone);
      return { phone, message: 'Код надіслано в SMS' };
    },
  });

// Куди вести користувача після успішної авторизації.
// Новий користувач з Google/Facebook ще без компанії → «Завершіть реєстрацію» (компанія + телефон),
// компанія є, але телефон не підтверджено → SMS-код, усе є → робочий простір
export function nextPageFor(user) {
  if (!user) return '/pages/login.html';
  if (!user.companyId) return '/pages/onboarding.html';
  // номер уже вказано (на кроці «Завершіть реєстрацію») → одразу поле для коду, інакше — спершу номер
  if (user.phoneVerified === false) return `/pages/verify-phone.html?mode=${user.phone ? 'social' : 'add'}&email=${encodeURIComponent(user.email)}`;
  return '/pages/dashboard.html';
}

/**
 * Завершити реєстрацію після входу через Google/Facebook (користувач уже має токен).
 * Сервер прив'язує компанію (create → роль owner, join → manager), зберігає телефон і шле SMS-код.
 * Відповідь: { user, message } — user уже з companyId, але phoneVerified: false
 */
export async function completeSignup({ name, phone, company }) {
  const data = await request('/auth/complete-signup', {
    method: 'POST',
    body: { name, phone, company },
    mock: () => {
      if (company?.mode === 'join' && company.code.toUpperCase() !== MOCK_INVITE) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
      }
      const role = company.mode === 'create' ? 'owner' : 'manager';
      const companyName = company.mode === 'create' ? company.name : MOCK_COMPANY;
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      sessionStorage.setItem('mockCompany', companyName);
      sessionStorage.setItem('mockRole', role);
      const user = { ...getCurrentUser(), name, phone, phoneVerified: false, role, companyId: 'cmp_01', companyName };
      return { user, message: 'Код надіслано в SMS' };
    },
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
    mock: () => {
      checkMockCode(code);
      return { message: 'Пароль змінено' };
    },
  });

// ---------- Соцмережі ----------
// Google: credential — ID-токен від Google Identity Services, бекенд перевіряє його підпис
export async function loginWithGoogle(credential) {
  const data = await request('/auth/google', {
    method: 'POST',
    auth: false,
    body: { credential },
    // У моках перший вхід — новий користувач без компанії; після завершення реєстрації — звичайний вхід
    mock: () =>
      localStorage.getItem('nevpade.mock.socialDone')
        ? { token: 'mock-token', user: mockUser('olena.koval@gmail.com', 'Олена Коваль') }
        : { token: 'mock-token', isNew: true, user: { ...mockUser('olena.koval@gmail.com', 'Олена Коваль', null, false), role: null, companyId: null, companyName: null } },
  });
  saveSession(data);
  return data.user;
}

// Facebook: accessToken від Facebook SDK, бекенд перевіряє його через Graph API
export async function loginWithFacebook(accessToken) {
  const data = await request('/auth/facebook', {
    method: 'POST',
    auth: false,
    body: { accessToken },
    mock: () =>
      localStorage.getItem('nevpade.mock.socialDone')
        ? { token: 'mock-token', user: mockUser('olena.koval@gmail.com', 'Олена Коваль') }
        : { token: 'mock-token', isNew: true, user: { ...mockUser('olena.koval@gmail.com', 'Олена Коваль', null, false), role: null, companyId: null, companyName: null } },
  });
  saveSession(data);
  return data.user;
}

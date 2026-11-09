import { request, ApiError } from './client.js';

// У режимі моків правильний код підтвердження завжди такий:
export const MOCK_CODE = '123456';

const mockUser = (email, name = 'Менеджер', phone = '+380671234567', phoneVerified = true) => ({
  id: 'usr_01',
  name,
  email,
  phone,
  phoneVerified,
  role: 'manager',
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

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту, потім телефон
export const register = ({ name, email, phone, password }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, phone, password },
    mock: () => {
      // щоб у моках показати введені дані
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
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

// Куди вести користувача після успішної авторизації
export const nextPageFor = (user) =>
  user && user.phoneVerified === false
    ? `/pages/verify-phone.html?mode=add&email=${encodeURIComponent(user.email)}`
    : '/index.html';

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
    mock: () => ({ token: 'mock-token', user: mockUser('google.user@gmail.com', 'Користувач Google', null, false) }),
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
    mock: () => ({ token: 'mock-token', user: mockUser('fb.user@example.com', 'Користувач Facebook', null, false) }),
  });
  saveSession(data);
  return data.user;
}

import { request, ApiError } from './client.js';

// У режимі моків правильний код підтвердження завжди такий:
export const MOCK_CODE = '123456';

const mockUser = (email, name = 'Менеджер') => ({ id: 'usr_01', name, email, role: 'manager' });

function checkMockCode(code) {
  if (code !== MOCK_CODE) throw new ApiError('Невірний код підтвердження', 400, 'invalid_code');
}

// ---------- Сесія ----------
export function saveSession({ token, user }) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

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

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту кодом
export const register = ({ name, email, password }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, password },
    mock: () => {
      sessionStorage.setItem('mockName', name); // щоб у моках показати введене ім'я
      return { email, message: 'Код підтвердження надіслано на пошту' };
    },
  });

export async function verifyEmail(email, code) {
  const data = await request('/auth/verify-email', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      return { token: 'mock-token', user: mockUser(email, sessionStorage.getItem('mockName') || undefined) };
    },
  });
  saveSession(data);
  return data.user;
}

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
    mock: () => ({ token: 'mock-token', user: mockUser('google.user@gmail.com', 'Користувач Google') }),
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
    mock: () => ({ token: 'mock-token', user: mockUser('fb.user@example.com', 'Користувач Facebook') }),
  });
  saveSession(data);
  return data.user;
}

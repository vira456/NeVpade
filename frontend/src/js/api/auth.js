import { request } from './client.js';

export async function login(email, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: { email, password },
    mock: { token: 'mock-token', user: { id: 'usr_01', name: 'Менеджер', role: 'manager' } },
  });
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  location.href = '/pages/login.html';
}

// Єдина точка зв'язку з бекендом.
// Сторінки не викликають fetch напряму — лише функції з папки api/.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const isMockMode = USE_MOCK;

export async function request(path, { method = 'GET', body, mock } = {}) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 300)); // імітація затримки мережі
    return mock === undefined ? null : structuredClone(mock);
  }

  const token = localStorage.getItem('token');
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401) {
    localStorage.removeItem('token');
    location.href = '/pages/login.html';
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Помилка ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

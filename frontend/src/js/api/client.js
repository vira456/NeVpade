// Єдина точка зв'язку з бекендом.
// Сторінки не викликають fetch напряму — лише функції з папки api/.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const isMockMode = USE_MOCK;

// Помилка API: message — текст для користувача, status — HTTP-код, code — машинний код (якщо є)
export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, mock?: any, auth?: boolean }} options
 *   mock — дані для режиму моків; може бути функцією (тоді її викликають і вона може кинути ApiError)
 *   auth — false для публічних запитів (логін, реєстрація), щоб 401 не перекидав на сторінку входу
 */
export async function request(path, { method = 'GET', body, mock, auth = true } = {}) {
  if (USE_MOCK) {
    await new Promise((r) => setTimeout(r, 400)); // імітація затримки мережі
    const data = typeof mock === 'function' ? mock(body) : mock;
    return data === undefined ? null : structuredClone(data);
  }

  const token = localStorage.getItem('token');
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && token && { Authorization: `Bearer ${token}` }),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Сервер недоступний. Перевірте підключення.', 0);
  }

  if (res.status === 401 && auth) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    location.href = '/pages/login.html';
    return null;
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const detail = Array.isArray(err.detail) ? err.detail[0]?.msg : err.detail;
    throw new ApiError(detail || `Помилка ${res.status}`, res.status, err.code);
  }
  return res.status === 204 ? null : res.json();
}

// Єдина точка зв'язку з бекендом.
// Сторінки не викликають fetch напряму — лише функції з папки api/.
const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false';
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export const isMockMode = USE_MOCK;
// Імітація затримки мережі в режимі моків (мс). Можна змінити в .env: VITE_MOCK_DELAY=0
const MOCK_DELAY = Number(import.meta.env.VITE_MOCK_DELAY ?? 150);

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
 * Події api:start / api:end потрібні індикатору завантаження (utils/loader.js).
 */
export async function request(path, options = {}) {
  window.dispatchEvent(new Event('api:start'));
  try {
    return await doRequest(path, options);
  } finally {
    window.dispatchEvent(new Event('api:end'));
  }
}

async function doRequest(path, { method = 'GET', body, mock, auth = true } = {}) {
  if (USE_MOCK) {
    if (MOCK_DELAY) await new Promise((r) => setTimeout(r, MOCK_DELAY));
    const data = typeof mock === 'function' ? await mock(body) : mock; // мок може бути async (напр. файли в IndexedDB)
    return data === undefined ? null : structuredClone(data);
  }

  const token = localStorage.getItem('token');
  const isForm = body instanceof FormData; // файли — multipart/form-data, заголовок браузер ставить сам
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(!isForm && { 'Content-Type': 'application/json' }),
        ...(auth && token && { Authorization: `Bearer ${token}` }),
      },
      body: isForm ? body : body ? JSON.stringify(body) : undefined,
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

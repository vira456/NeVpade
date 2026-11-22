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

// Демо-режим живе в окремій папці mock/ і вантажиться лише тоді, коли він увімкнений:
// з бекендом (VITE_USE_MOCK=false) Vite викидає цю гілку зі збірки разом з демо-даними.
let mockLayer;
const loadMock = () => (mockLayer ??= import('../mock/index.js'));

/**
 * @param {string} path
 * @param {{ method?: string, body?: any, mock?: any, auth?: boolean }} options
 *   mock — відповідь у режимі моків: значення або функція (m) => …, де m — модулі з папки mock/
 *          (m.trips, m.auth, …); функція може кинути ApiError, як сервер
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
    const data = typeof mock === 'function' ? await mock(await loadMock()) : mock; // мок може бути async (напр. файли в IndexedDB)
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
    // FastAPI віддає помилки по-різному: { detail: "текст" }, { detail: [{ msg }] } (422)
    // або { detail: { message, code } } — розбираємо всі варіанти
    const d = err.detail;
    const detail = Array.isArray(d) ? d[0]?.msg : d && typeof d === 'object' ? d.message ?? d.msg : d;
    if (d && typeof d === 'object' && !Array.isArray(d) && d.code && !err.code) err.code = d.code;
    // Вхід через Google є, але реєстрацію не завершено (немає компанії чи телефону) → повертаємо на потрібний крок
    if (res.status === 403 && err.code === 'signup_incomplete' && !location.pathname.includes('/onboarding') && !location.pathname.includes('/verify-phone')) {
      location.replace('/pages/onboarding.html'); // сторінка сама переведе далі, якщо компанія вже є
      return null;
    }
    // стандартні англійські відповіді FastAPI — перекладаємо, щоб користувач розумів, що сталося
    const STD = {
      'Not Found': 'Цей розділ ще не підключено на сервері',
      'Method Not Allowed': 'Ця дія ще не підтримується сервером',
      'Internal Server Error': 'Помилка на сервері. Спробуйте пізніше',
      Forbidden: 'Недостатньо прав для цієї дії',
      'Not authenticated': 'Сесія закінчилась. Увійдіть знову',
    };
    // 403 без пояснення — це брак прав (напр. дія лише для власника)
    if (res.status === 403 && !detail) throw new ApiError('Недостатньо прав для цієї дії', 403, err.code ?? 'forbidden');
    throw new ApiError(STD[detail] ?? (detail || `Помилка ${res.status}`), res.status, err.code);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? normalizeIds(JSON.parse(text)) : null;
}

// MongoDB повертає _id — сторінки всюди працюють з id, тож доповнюємо
function normalizeIds(value) {
  if (Array.isArray(value)) return value.map(normalizeIds);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = normalizeIds(v);
    if (out._id !== undefined && out.id === undefined) out.id = String(out._id);
    return out;
  }
  return value;
}

// Завантаження сторінок пошуку біржі Della.
// Режим розробки (npm run dev) і моки: через проксі Vite «/della/…» (налаштовано у vite.config.js).
// Робоча версія з бекендом: GET /import/della?path=/search/….html → { html } (бекенд Іри).
import { request, ApiError, isMockMode } from './client.js';

const DELLA_URL = /^https?:\/\/(?:www\.)?della\.ua(\/[^\s#]*)$/i;
const MIN_INTERVAL = 15_000; // не частіше ніж раз на 15 с для однієї сторінки — не навантажуємо Della
const cache = new Map(); // url → { at, html }

/** Перевіряє посилання і повертає шлях: «https://della.ua/search/x.html» → «/search/x.html» */
export function dellaPath(url) {
  const m = String(url).trim().match(DELLA_URL);
  if (!m || !m[1].startsWith('/search/')) {
    throw new ApiError('Вставте посилання на сторінку пошуку Della, наприклад https://della.ua/search/….html', 400, 'bad_url');
  }
  return m[1];
}

async function download(path) {
  if (import.meta.env.DEV || isMockMode) {
    window.dispatchEvent(new Event('api:start'));
    try {
      const res = await fetch(`/della${path}`, { headers: { Accept: 'text/html' } });
      if (!res.ok) throw new ApiError(`Della не відповідає (код ${res.status}). Спробуйте пізніше.`, res.status);
      return await res.text();
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('Немає зв\'язку з Della. Перевірте інтернет і що сайт запущено через npm run dev.', 0, 'network');
    } finally {
      window.dispatchEvent(new Event('api:end'));
    }
  }
  const { html } = await request(`/import/della?path=${encodeURIComponent(path)}`);
  return html;
}

/** HTML сторінки пошуку Della (з коротким кешем) */
export async function fetchDellaPage(url, { force = false } = {}) {
  const path = dellaPath(url);
  const hit = cache.get(path);
  if (hit && (!force || Date.now() - hit.at < MIN_INTERVAL)) return { html: hit.html, at: hit.at };
  const html = await download(path);
  if (!/request_card|Знайдено/.test(html)) {
    throw new ApiError('Della не віддала список вантажів (можливо, тимчасове обмеження). Спробуйте за хвилину.', 502, 'no_listings');
  }
  const entry = { at: Date.now(), html };
  cache.set(path, entry);
  return entry;
}

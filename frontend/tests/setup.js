// Спільне для всіх тестів
import { beforeEach } from 'vitest';

// jsdom не має matchMedia, а utils/prefs.js читає його при завантаженні (тема ОС)
window.matchMedia ??= (query) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} });

// Кожен тест починає з чистого «браузера»: без сесії й без змінених демо-даних
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

/** Увійти як користувач (так робить saveSession після входу) */
export function signIn(user) {
  localStorage.setItem('token', 'test-token');
  localStorage.setItem('user', JSON.stringify(user));
}

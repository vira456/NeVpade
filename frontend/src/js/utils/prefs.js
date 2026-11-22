// Тема (світла / темна / як у системі) і мова інтерфейсу.
// Значення зберігаються в localStorage; скрипт у <head> застосовує їх ще до показу сторінки.
import { load, save } from './storage.js';

const media = window.matchMedia('(prefers-color-scheme: dark)');

export const getTheme = () => load('theme', 'system'); // light | dark | system
export const getLang = () => (load('lang', 'uk') === 'en' ? 'en' : 'uk');

export function applyTheme(theme = getTheme()) {
  const dark = theme === 'dark' || (theme === 'system' && media.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent('themechange', { detail: { dark } }));
}

export function setTheme(theme) {
  save('theme', theme);
  applyTheme(theme);
}

// Якщо вибрано «як у системі» — реагуємо на зміну теми ОС
media.addEventListener('change', () => getTheme() === 'system' && applyTheme());

export function setLang(lang) {
  save('lang', lang);
  location.reload(); // текст сторінки перекладається під час завантаження
}

// Вузьке вікно (< 1200 px): панель за замовчуванням згорнута до іконок, щоб таблицям вистачало місця.
// Розгорнути її там можна кнопкою — це запам'ятовується лише до закриття вкладки.
export const NARROW_QUERY = '(max-width: 1199px)';
const isNarrow = () => window.matchMedia(NARROW_QUERY).matches;
export const isSidebarCollapsed = () =>
  isNarrow() ? sessionStorage.getItem('nevpade.sidebarNarrowOpen') !== '1' : load('sidebarCollapsed', false) === true;

export function setSidebarCollapsed(collapsed) {
  if (isNarrow()) sessionStorage.setItem('nevpade.sidebarNarrowOpen', collapsed ? '0' : '1');
  else save('sidebarCollapsed', collapsed);
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
}

/** Вікно змінило ширину — підлаштовуємо панель */
export function syncSidebarToWidth() {
  const collapsed = isSidebarCollapsed();
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
  return collapsed;
}

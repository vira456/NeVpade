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

export const isSidebarCollapsed = () => load('sidebarCollapsed', false) === true;

export function setSidebarCollapsed(collapsed) {
  save('sidebarCollapsed', collapsed);
  document.documentElement.classList.toggle('sidebar-collapsed', collapsed);
}

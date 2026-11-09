import '../../scss/main.scss';
import { isMockMode } from '../api/client.js';
import { isLoggedIn, getCurrentUser, logout } from '../api/auth.js';
import { escapeHtml } from './format.js';

const LINKS = [
  { href: '/index.html', label: 'Аналітика' },
  { href: '/pages/trips.html', label: 'Рейси' },
  { href: '/pages/map.html', label: 'Карта' },
  { href: '/pages/fleet.html', label: 'Автопарк' },
  { href: '/pages/kanban.html', label: 'Завдання' },
];

// Малює бокове меню на кожній внутрішній сторінці.
// Якщо користувач не увійшов — перенаправляє на сторінку входу.
export function renderLayout() {
  if (!isLoggedIn()) {
    location.replace('/pages/login.html');
    return;
  }

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const current = location.pathname === '/' ? '/index.html' : location.pathname;
  const user = getCurrentUser();

  sidebar.innerHTML = `
    <div class="sidebar__logo">NeVpade</div>
    <nav class="sidebar__nav">
      ${LINKS.map(
        (l) => `<a class="sidebar__link ${current === l.href ? 'is-active' : ''}" href="${l.href}">${l.label}</a>`
      ).join('')}
    </nav>
    <div class="sidebar__user">
      <span class="sidebar__user-name">${escapeHtml(user?.name ?? '')}</span>
      <button class="sidebar__logout" id="logoutBtn" type="button">Вийти</button>
    </div>
  `;
  document.getElementById('logoutBtn').addEventListener('click', logout);

  if (isMockMode) console.info('[NeVpade] Режим мокових даних (VITE_USE_MOCK=true)');
}

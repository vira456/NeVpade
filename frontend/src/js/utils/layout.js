import '../../scss/main.scss';
import { isMockMode } from '../api/client.js';

const LINKS = [
  { href: '/index.html', label: 'Аналітика' },
  { href: '/pages/trips.html', label: 'Рейси' },
  { href: '/pages/map.html', label: 'Карта' },
  { href: '/pages/fleet.html', label: 'Автопарк' },
  { href: '/pages/kanban.html', label: 'Завдання' },
];

// Малює бокове меню на кожній сторінці та підсвічує активний пункт
export function renderLayout() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const current = location.pathname === '/' ? '/index.html' : location.pathname;

  sidebar.innerHTML = `
    <div class="sidebar__logo">NeVpade</div>
    <nav class="sidebar__nav">
      ${LINKS.map(
        (l) => `<a class="sidebar__link ${current === l.href ? 'is-active' : ''}" href="${l.href}">${l.label}</a>`
      ).join('')}
    </nav>
  `;

  if (isMockMode) console.info('[NeVpade] Режим мокових даних (VITE_USE_MOCK=true)');
}

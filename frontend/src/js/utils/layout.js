import '../../scss/main.scss';
import { isMockMode } from '../api/client.js';
import { isLoggedIn, getCurrentUser, logout, nextPageFor } from '../api/auth.js';
import { escapeHtml } from './format.js';
import { icons, logoMark } from './icons.js';

const LINKS = [
  { href: '/index.html', label: 'Аналітика', icon: icons.analytics },
  { href: '/pages/trips.html', label: 'Рейси', icon: icons.trips },
  { href: '/pages/map.html', label: 'Карта', icon: icons.map },
  { href: '/pages/fleet.html', label: 'Автопарк', icon: icons.fleet },
  { href: '/pages/kanban.html', label: 'Завдання', icon: icons.tasks },
  { href: '/pages/profile.html', label: 'Профіль', icon: icons.profile },
];

// Ініціали для аватара без фото: «Федорова Віра Дмитрівна» → «ФВ»
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// Малює бокове меню на кожній внутрішній сторінці.
// Якщо користувач не увійшов — перенаправляє на сторінку входу.
export function renderLayout() {
  if (!isLoggedIn()) {
    location.replace('/pages/login.html');
    return;
  }
  // Увійшов через Google/Facebook, але ще не підтвердив телефон
  const next = nextPageFor(getCurrentUser());
  if (next !== '/index.html') {
    location.replace(next);
    return;
  }

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const current = location.pathname === '/' ? '/index.html' : location.pathname;
  const user = getCurrentUser();

  sidebar.innerHTML = `
    <a class="sidebar__logo" href="/index.html">${logoMark}<span>NeVpade</span></a>
    <nav class="sidebar__nav" aria-label="Головне меню">
      ${LINKS.map(
        (l) =>
          `<a class="sidebar__link ${current === l.href ? 'is-active' : ''}" href="${l.href}" ${
            current === l.href ? 'aria-current="page"' : ''
          }>${l.icon}<span>${l.label}</span></a>`
      ).join('')}
    </nav>
    <div class="sidebar__user">
      <a class="sidebar__profile" href="/pages/profile.html" title="Профіль"></a>
      <button class="sidebar__logout" id="logoutBtn" type="button" title="Вийти" aria-label="Вийти">${icons.logout}</button>
    </div>
  `;
  renderSidebarUser();
  document.getElementById('logoutBtn').addEventListener('click', logout);

  if (isMockMode) console.info('[NeVpade] Режим мокових даних (VITE_USE_MOCK=true)');
}

// Окремо, щоб профіль міг оновити ім'я/фото в меню без перезавантаження
export function renderSidebarUser() {
  const link = document.querySelector('.sidebar__profile');
  if (!link) return;
  const user = getCurrentUser();
  const avatar = user?.avatarUrl
    ? `<img class="sidebar__avatar" src="${escapeHtml(user.avatarUrl)}" alt="" />`
    : `<span class="sidebar__avatar">${escapeHtml(initials(user?.name))}</span>`;
  link.innerHTML = `${avatar}<span class="sidebar__user-name">${escapeHtml(user?.name ?? '')}</span>`;
}

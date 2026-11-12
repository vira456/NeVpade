// Каркас внутрішніх сторінок: бокова панель (згортається), меню на телефоні,
// перемикачі теми й мови, захист від неавторизованого доступу.
import '../i18n/index.js'; // переклад має запуститися раніше за малювання сторінки
import './loader.js';
import { isMockMode } from '../api/client.js';
import { isLoggedIn, getCurrentUser, logout, nextPageFor } from '../api/auth.js';
import { escapeHtml } from './format.js';
import { withThemeReveal } from './motion.js';
import { icons, logoMark } from './icons.js';
import { getTheme, setTheme, getLang, setLang, isSidebarCollapsed, setSidebarCollapsed } from './prefs.js';
import { countUnread } from '../api/chat.js';

export const DASHBOARD = '/pages/dashboard.html';

const SECTIONS = [
  {
    title: 'Робота',
    links: [
      { href: DASHBOARD, label: 'Аналітика', icon: icons.analytics },
      { href: '/pages/trips.html', label: 'Рейси', icon: icons.trips },
      { href: '/pages/map.html', label: 'Карта', icon: icons.map },
      { href: '/pages/fleet.html', label: 'Автопарк', icon: icons.fleet },
      { href: '/pages/kanban.html', label: 'Завдання', icon: icons.tasks },
    ],
  },
  {
    title: 'Компанія',
    links: [
      { href: '/pages/team.html', label: 'Команда', icon: icons.team },
      { href: '/pages/chat.html', label: 'Чат', icon: icons.chat, badge: 'chat' },
    ],
  },
];

// Ініціали для аватара без фото: «Федорова Віра Дмитрівна» → «ФВ»
export const initials = (name = '') =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

// Кількість непрочитаних у чаті (оновлює сторінка чату та сам чат-модуль)
export function setChatBadge(count) {
  const badge = document.querySelector('[data-badge="chat"]');
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : count;
}

export function renderLayout() {
  if (!isLoggedIn()) {
    location.replace('/pages/login.html');
    return;
  }
  // Увійшов через Google/Facebook, але ще не підтвердив телефон
  const next = nextPageFor(getCurrentUser());
  if (next !== DASHBOARD) {
    location.replace(next);
    return;
  }

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const current = location.pathname;
  const theme = getTheme();
  const lang = getLang();

  sidebar.id = 'sidebar';
  sidebar.setAttribute('aria-label', 'Бокова панель');
  sidebar.innerHTML = `
    <div class="sidebar__top">
      <a class="sidebar__logo" href="${DASHBOARD}" title="NeVpade">${logoMark}<span>NeVpade</span></a>
      <button class="sidebar__toggle" id="sidebarToggle" type="button" aria-controls="sidebar" aria-expanded="${!isSidebarCollapsed()}" title="Згорнути панель" aria-label="Згорнути панель">${icons.chevronLeft}</button>
    </div>
    ${SECTIONS.map(
      (sec) => `
      <p class="sidebar__section">${sec.title}</p>
      <nav class="sidebar__nav" aria-label="${sec.title}">
        ${sec.links
          .map((l) => {
            const active = current === l.href;
            return `<a class="sidebar__link ${active ? 'is-active' : ''}" href="${l.href}" title="${l.label}" ${active ? 'aria-current="page"' : ''}>
              ${l.icon}<span>${l.label}</span>${l.badge ? `<span class="sidebar__badge" data-badge="${l.badge}" hidden></span>` : ''}
            </a>`;
          })
          .join('')}
      </nav>`
    ).join('')}
    <div class="sidebar__bottom">
      <div class="sidebar__prefs">
        <div class="pref" role="group" aria-label="Тема">
          <button type="button" data-theme-set="light" aria-pressed="${theme === 'light'}" title="Світла тема" aria-label="Світла тема">${icons.sun}</button>
          <button type="button" data-theme-set="dark" aria-pressed="${theme === 'dark'}" title="Темна тема" aria-label="Темна тема">${icons.moon}</button>
          <button type="button" data-theme-set="system" aria-pressed="${theme === 'system'}" title="Як у системі" aria-label="Як у системі">${icons.monitor}</button>
        </div>
        <div class="pref" role="group" aria-label="Мова" data-no-i18n>
          <button type="button" data-lang-set="uk" aria-pressed="${lang === 'uk'}" title="Українська">UA</button>
          <button type="button" data-lang-set="en" aria-pressed="${lang === 'en'}" title="English">EN</button>
        </div>
      </div>
      <div class="sidebar__user">
        <a class="sidebar__profile ${current === '/pages/profile.html' ? 'is-active' : ''}" href="/pages/profile.html" title="Мій профіль" ${current === '/pages/profile.html' ? 'aria-current="page"' : ''}></a>
        <button class="sidebar__logout" id="logoutBtn" type="button" title="Вийти" aria-label="Вийти">${icons.logout}</button>
      </div>
    </div>
  `;
  renderSidebarUser();

  // ---------- Події ----------
  document.getElementById('logoutBtn').addEventListener('click', logout);

  const toggle = document.getElementById('sidebarToggle');
  toggle.addEventListener('click', () => {
    const collapsed = !isSidebarCollapsed();
    setSidebarCollapsed(collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  });

  sidebar.querySelectorAll('[data-theme-set]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      withThemeReveal(e, () => setTheme(btn.dataset.themeSet));
      sidebar.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    })
  );
  sidebar.querySelectorAll('[data-lang-set]').forEach((btn) =>
    btn.addEventListener('click', () => btn.dataset.langSet !== lang && setLang(btn.dataset.langSet))
  );

  renderMobileBar(sidebar);
  if (current !== '/pages/chat.html') countUnread().then(setChatBadge).catch(() => {});

  if (isMockMode) console.info('[NeVpade] Режим мокових даних (VITE_USE_MOCK=true)');
}

// На телефоні панель ховається; кнопка «меню» відкриває її поверх сторінки
function renderMobileBar(sidebar) {
  const main = document.querySelector('.main');
  if (!main || main.querySelector('.mobile-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'mobile-bar';
  bar.innerHTML = `
    <button class="mobile-bar__menu" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Відкрити меню">${icons.menu}</button>
    <a class="mobile-bar__logo" href="${DASHBOARD}">${logoMark}<span>NeVpade</span></a>`;
  main.prepend(bar);

  const backdrop = document.createElement('div');
  backdrop.className = 'sidebar-backdrop';
  document.body.appendChild(backdrop);

  const btn = bar.querySelector('.mobile-bar__menu');
  const setOpen = (open) => {
    sidebar.classList.toggle('is-open', open);
    backdrop.classList.toggle('is-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (open) sidebar.querySelector('a, button')?.focus();
  };
  btn.addEventListener('click', () => setOpen(true));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && sidebar.classList.contains('is-open') && (setOpen(false), btn.focus()));
}

// Окремо, щоб профіль міг оновити ім'я/фото в меню без перезавантаження
export function renderSidebarUser() {
  const link = document.querySelector('.sidebar__profile');
  if (!link) return;
  const user = getCurrentUser();
  const avatar = user?.avatarUrl
    ? `<img class="sidebar__avatar" src="${escapeHtml(user.avatarUrl)}" alt="" />`
    : `<span class="sidebar__avatar" data-no-i18n>${escapeHtml(initials(user?.name))}</span>`;
  link.innerHTML = `${avatar}<span class="sidebar__who"><span class="sidebar__user-name" data-no-i18n>${escapeHtml(user?.name ?? '')}</span><span class="sidebar__company" data-no-i18n>${escapeHtml(user?.companyName ?? '')}</span></span>`;
}

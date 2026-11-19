// Каркас внутрішніх сторінок: бокова панель (згортається), меню на телефоні,
// перемикачі теми й мови, захист від неавторизованого доступу.
import '../i18n/index.js'; // переклад має запуститися раніше за малювання сторінки
import './loader.js';
import { isMockMode } from '../api/client.js';
import { isLoggedIn, getCurrentUser, logout, nextPageFor, signupIncomplete, refreshSession, homeFor, roleOf, OWNER_HOME } from '../api/auth.js';
import { escapeHtml } from './format.js';
import { withThemeReveal } from './motion.js';
import { icons, logoMark } from './icons.js';
import { initReminders } from './reminders.js';
import { getTheme, setTheme, getLang, setLang, isSidebarCollapsed, setSidebarCollapsed } from './prefs.js';
import { countUnread } from '../api/chat.js';

export const DASHBOARD = '/pages/dashboard.html';

const SECTIONS = [
  {
    title: 'Робота',
    links: [
      { href: DASHBOARD, label: 'Аналітика', icon: icons.analytics },
      { href: '/pages/trips.html', label: 'Рейси', icon: icons.trips },
      { href: '/pages/clients.html', label: 'Клієнти', icon: icons.building },
      { href: '/pages/schedule.html', label: 'Графік машин', icon: icons.calendar },
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

// Окремий інтерфейс власника: лише керування компанією, без робочих розділів менеджерів
export const OWNER_PAGES = {
  overview: OWNER_HOME,
  team: '/pages/owner-team.html',
  finance: '/pages/owner-finance.html',
  settings: '/pages/owner-settings.html',
};
const OWNER_SECTIONS = [
  {
    title: 'Керування',
    links: [
      { href: OWNER_PAGES.overview, label: 'Огляд', icon: icons.analytics },
      { href: OWNER_PAGES.team, label: 'Менеджери', icon: icons.team, badge: 'requests' },
      { href: OWNER_PAGES.finance, label: 'Фінанси', icon: icons.wallet },
      { href: OWNER_PAGES.settings, label: 'Компанія', icon: icons.settings },
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

// Кількість заявок на вступ (кабінет власника)
export function setOwnerBadge(count) {
  const badge = document.querySelector('[data-badge="requests"]');
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 9 ? '9+' : String(count);
  badge.title = count ? `${count}` : '';
}

// Кількість непрочитаних у чаті (оновлює сторінка чату та сам чат-модуль)
export function setChatBadge(count) {
  const badge = document.querySelector('[data-badge="chat"]');
  if (!badge) return;
  badge.hidden = !count;
  badge.textContent = count > 99 ? '99+' : count;
}

/**
 * Каркас сторінки. access — для кого сторінка:
 *   'manager' (за замовчуванням) — робочі розділи менеджера; власника переводимо в його кабінет;
 *   'owner' — кабінет власника; менеджер бачить «доступно лише власнику»;
 *   'any' — обом (профіль колеги).
 * Повертає false, якщо сторінку показувати не можна (тоді скрипт сторінки дані не вантажить).
 * Ховання кнопок і цей захист — лише зручність: права на кожну дію перевіряє сервер (403).
 */
export function renderLayout({ access = 'manager' } = {}) {
  if (!isLoggedIn()) {
    location.replace('/pages/login.html');
    return false;
  }
  // Увійшов через Google, але ще не завершив реєстрацію (компанія, телефон)
  const user = getCurrentUser();
  if (signupIncomplete(user)) {
    location.replace(nextPageFor(user));
    return false;
  }
  const isOwnerUser = roleOf(user) === 'owner';
  // власник у робочих розділах менеджера не працює — одразу в кабінет
  if (isOwnerUser && access === 'manager') {
    location.replace(OWNER_HOME);
    return false;
  }
  const allowed = access === 'any' || roleOf(user) === access;
  document.documentElement.classList.toggle('owner-ui', isOwnerUser);

  // Роль чи компанію могли змінити, поки людина була на сайті (передали компанію, прибрали з компанії) —
  // звіряємось із сервером і, якщо щось змінилось, перемальовуємо сторінку з новими правами
  refreshSession().then((res) => {
    if (!res?.changed) return;
    if (signupIncomplete(res.user)) location.replace(nextPageFor(res.user));
    else location.replace(homeFor(res.user));
  });

  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return allowed;
  const current = location.pathname;
  const theme = getTheme();
  const lang = getLang();
  const sections = isOwnerUser ? OWNER_SECTIONS : SECTIONS;
  const profileHref = isOwnerUser ? OWNER_PAGES.settings : '/pages/profile.html';
  // профіль колеги — підрозділ «Команди» (у власника — «Менеджерів»)
  const isActive = (href) =>
    current === href || (current === '/pages/member.html' && href === (isOwnerUser ? OWNER_PAGES.team : '/pages/team.html'));

  sidebar.id = 'sidebar';
  sidebar.setAttribute('aria-label', 'Бокова панель');
  sidebar.innerHTML = `
    <div class="sidebar__top">
      <a class="sidebar__logo" href="${homeFor(user)}" title="NeVpade">${logoMark}<span>NeVpade</span></a>
      <button class="sidebar__toggle" id="sidebarToggle" type="button" aria-controls="sidebar" aria-expanded="${!isSidebarCollapsed()}" title="Згорнути панель" aria-label="Згорнути панель">${icons.chevronLeft}</button>
    </div>
    ${isOwnerUser ? `<p class="sidebar__mode">${icons.key}<span>Кабінет власника</span></p>` : ''}
    <div class="sidebar__scroll">
    ${
      isOwnerUser
        ? ''
        : `<button class="sidebar__link sidebar__reminders" type="button" data-reminders title="Нагадування">
      ${icons.bell}<span>Нагадування</span><span class="sidebar__badge sidebar__badge--alert" data-reminders-badge hidden></span>
    </button>`
    }
    ${sections.map(
      (sec) => `
      <p class="sidebar__section">${sec.title}</p>
      <nav class="sidebar__nav" aria-label="${sec.title}">
        ${sec.links
          .map((l) => {
            const active = isActive(l.href);
            return `<a class="sidebar__link ${active ? 'is-active' : ''}" href="${l.href}" title="${l.label}" ${active ? 'aria-current="page"' : ''}>
              ${l.icon}<span>${l.label}</span>${l.badge ? `<span class="sidebar__badge" data-badge="${l.badge}" hidden></span>` : ''}
            </a>`;
          })
          .join('')}
      </nav>`
    ).join('')}
    </div>
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
        <a class="sidebar__profile ${current === profileHref ? 'is-active' : ''}" href="${profileHref}" title="${isOwnerUser ? 'Мій акаунт' : 'Мій профіль'}" ${current === profileHref ? 'aria-current="page"' : ''}></a>
        <button class="sidebar__logout" id="logoutBtn" type="button" title="Вийти" aria-label="Вийти">${icons.logout}</button>
      </div>
    </div>
  `;
  renderSidebarUser();
  saveSnapshotOnLeave(sidebar);

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

  renderMobileBar(sidebar, isOwnerUser);
  // у власника — лічильник нових заявок на вступ біля «Менеджерів»
  if (isOwnerUser) import('../api/company.js').then(({ getJoinRequests }) => getJoinRequests().then((list) => setOwnerBadge(list?.length ?? 0))).catch(() => {});
  if (!isOwnerUser) {
    initReminders({
      buttons: [...document.querySelectorAll('[data-reminders]')],
      badges: [...document.querySelectorAll('[data-reminders-badge]')],
    });
    if (current !== '/pages/chat.html') countUnread().then(setChatBadge).catch(() => {});
  }

  if (isMockMode) console.info('[NeVpade] Режим мокових даних (VITE_USE_MOCK=true)');
  if (!allowed) renderDenied();
  return allowed;
}

// Сторінка лише для власника, а зайшов менеджер (за посиланням чи вручну набравши адресу)
function renderDenied() {
  const main = document.querySelector('.main');
  if (!main) return;
  main.querySelectorAll(':scope > :not(.mobile-bar)').forEach((el) => el.remove());
  main.insertAdjacentHTML(
    'beforeend',
    `<section class="denied" role="alert">
      <span class="denied__icon">${icons.shield}</span>
      <h1 class="denied__title">Цей розділ доступний лише власнику компанії</h1>
      <p class="denied__text">Кабінет власника — окремий інтерфейс: менеджери, фінанси й налаштування компанії. Щоб відкрити його, вийдіть і увійдіть як власник — з кодом власника.</p>
      <a class="btn" href="${DASHBOARD}">Перейти до аналітики</a>
    </section>`
  );
}

// На телефоні панель ховається; кнопка «меню» відкриває її поверх сторінки
function renderMobileBar(sidebar, isOwnerUser) {
  const main = document.querySelector('.main');
  if (!main || main.querySelector('.mobile-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'mobile-bar';
  bar.innerHTML = `
    <button class="mobile-bar__menu" type="button" aria-controls="sidebar" aria-expanded="false" aria-label="Відкрити меню">${icons.menu}</button>
    <a class="mobile-bar__logo" href="${homeFor(getCurrentUser())}">${logoMark}<span>NeVpade</span></a>
    ${isOwnerUser ? '' : `<button class="icon-btn mobile-bar__bell" type="button" data-reminders aria-label="Нагадування">${icons.bell}<span class="sidebar__badge sidebar__badge--alert" data-reminders-badge hidden></span></button>`}`;
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
// Знімок меню для наступної сторінки: head.html покаже його ще до завантаження скриптів,
// тож кнопки меню не «з'являються із запізненням»
export const SNAPSHOT_KEY = 'nevpade.sidebarSnapshot';
function saveSnapshotOnLeave(sidebar) {
  window.addEventListener('pagehide', () => {
    try {
      if (!localStorage.getItem('token')) return localStorage.removeItem(SNAPSHOT_KEY);
      const html = sidebar.innerHTML.replace(/ is-open/g, '');
      localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ lang: getLang(), role: roleOf(getCurrentUser()), html }));
    } catch {
      /* сховище недоступне — просто без знімка */
    }
  });
}

export function renderSidebarUser() {
  const link = document.querySelector('.sidebar__profile');
  if (!link) return;
  const user = getCurrentUser();
  const avatar = user?.avatarUrl
    ? `<img class="sidebar__avatar" src="${escapeHtml(user.avatarUrl)}" alt="" />`
    : `<span class="sidebar__avatar" data-no-i18n>${escapeHtml(initials(user?.name))}</span>`;
  link.innerHTML = `${avatar}<span class="sidebar__who"><span class="sidebar__user-name" data-no-i18n>${escapeHtml(user?.name ?? '')}</span><span class="sidebar__company" data-no-i18n>${escapeHtml(user?.companyName ?? '')}</span></span>`;
}

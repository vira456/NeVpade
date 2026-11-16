// Нагадування: що потребує уваги менеджера (страховка, ТО, документи, оплата, завдання, рейси без машини).
// Рахуються з даних, які вже є, і показуються в боковій панелі «Нагадування» на кожній сторінці.
// Кожне нагадування можна одним кліком перетворити на завдання в «Завданнях».
import { getVehicles } from '../api/vehicles.js';
import { getDrivers } from '../api/drivers.js';
import { getTrips, myId, isOwner } from '../api/trips.js';
import { getTasks, createTask } from '../api/tasks.js';
import { getDocumentsSummary } from '../api/documents.js';
import { escapeHtml, money, paymentStatus, daysPastDue } from './format.js';
import { icons } from './icons.js';
import { load, save } from './storage.js';
import { showToast } from './toast.js';
import { t, locale } from '../i18n/index.js';

const DAY = 864e5;
const today = () => new Date(new Date().toDateString());
const daysTo = (iso) => Math.round((new Date(`${iso}T00:00:00`) - today()) / DAY);
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const inDays = (n) => iso(new Date(today().getTime() + n * DAY));
const date = (s) => new Date(`${s}T00:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });

/** Зібрати нагадування. Кожне: { key, level: 'bad'|'warn', title, text, href, task } */
export async function collectReminders() {
  const [vehicles, drivers, trips, tasks, vDocs, dDocs] = await Promise.all([
    getVehicles(),
    getDrivers(),
    getTrips(),
    getTasks(),
    getDocumentsSummary('vehicles').catch(() => ({})),
    getDocumentsSummary('drivers').catch(() => ({})),
  ]);
  const out = [];
  const add = (r) => out.push(r);

  // Страховка й ТО
  for (const v of vehicles) {
    if (v.insuranceUntil) {
      const d = daysTo(v.insuranceUntil);
      if (d <= 30)
        add({
          key: `ins:${v.id}:${v.insuranceUntil}`,
          level: d < 0 ? 'bad' : 'warn',
          title: d < 0 ? t('Страховка {plate} прострочена', { plate: v.plate }) : t('Страховка {plate} закінчується', { plate: v.plate }),
          text: d < 0 ? t('Закінчилась {date}', { date: date(v.insuranceUntil) }) : t('Діє до {date} · {n} дн.', { date: date(v.insuranceUntil), n: d }),
          href: '/pages/fleet.html',
          task: { title: t('Продовжити страховку {plate}', { plate: v.plate }), priority: d < 7 ? 'high' : 'medium', dueDate: d < 0 ? inDays(1) : v.insuranceUntil },
        });
    }
    if (v.nextServiceKm) {
      const left = v.nextServiceKm - v.mileageKm;
      if (left <= 3000)
        add({
          key: `svc:${v.id}:${v.nextServiceKm}`,
          level: left < 0 ? 'bad' : 'warn',
          title: t('ТО для {plate}', { plate: v.plate }),
          text: left < 0 ? t('Прострочене на {n} км', { n: (-left).toLocaleString(locale()) }) : t('Залишилось {n} км', { n: left.toLocaleString(locale()) }),
          href: '/pages/fleet.html',
          task: { title: t('Записати {plate} на ТО', { plate: v.plate }), priority: left < 0 ? 'high' : 'medium', dueDate: inDays(7) },
        });
    }
    if (v.status === 'broken') {
      const planned = trips.filter((tr) => tr.vehicleId === v.id && tr.status === 'planned');
      if (planned.length)
        add({
          key: `broken:${v.id}:${planned.map((x) => x.id).join(',')}`,
          level: 'bad',
          title: t('{plate} зламалась, але стоїть у рейсах', { plate: v.plate }),
          text: planned.map((x) => x.number).join(', '),
          href: `/pages/trips.html?trip=${planned[0].id}`,
          task: { title: t('Замінити машину в рейсах {list}', { list: planned.map((x) => x.number).join(', ') }), priority: 'high', dueDate: inDays(1) },
        });
    }
  }

  // Документи (копії) з терміном дії
  const docs = (summary, list, label, href) => {
    for (const item of list) {
      const s = summary[item.id];
      if (!s || !(s.expired || s.expiring)) continue;
      add({
        key: `docs:${item.id}:${s.expired}:${s.expiring}`,
        level: s.expired ? 'bad' : 'warn',
        title: t('Документи: {name}', { name: label(item) }),
        text: [s.expired && t('прострочено: {n}', { n: s.expired }), s.expiring && t('скоро закінчуються: {n}', { n: s.expiring })].filter(Boolean).join(', '),
        href,
        task: { title: t('Оновити документи: {name}', { name: label(item) }), priority: s.expired ? 'high' : 'medium', dueDate: inDays(5) },
      });
    }
  };
  docs(vDocs, vehicles, (v) => v.plate, '/pages/fleet.html');
  docs(dDocs, drivers, (d) => d.name, '/pages/fleet.html');

  // Оплата: менеджер бачить свої рейси, керівник — усі
  const visible = trips.filter((tr) => isOwner() || tr.managerId === myId());
  const overdue = visible.filter((tr) => paymentStatus(tr) === 'overdue').sort((a, b) => daysPastDue(b) - daysPastDue(a));
  for (const tr of overdue.slice(0, 8)) {
    add({
      key: `pay:${tr.id}:${tr.payment.dueDate}`,
      level: 'bad',
      title: t('{client} не оплатив {n}', { client: tr.client?.name || '—', n: tr.number }),
      text: t('{sum} · прострочено {d} дн.', { sum: money(tr.price), d: daysPastDue(tr) }),
      href: `/pages/trips.html?trip=${tr.id}`,
      task: { title: t('Нагадати про оплату {n} ({client})', { n: tr.number, client: tr.client?.name || '—' }), priority: 'high', dueDate: inDays(1), tripId: tr.id },
    });
  }

  // Рейси на найближчі 2 дні без водія чи машини
  for (const tr of visible.filter((x) => x.status === 'planned' && daysTo(x.loadDate) <= 2 && daysTo(x.loadDate) >= 0 && (!x.driverId || !x.vehicleId))) {
    add({
      key: `crew:${tr.id}:${tr.driverId}:${tr.vehicleId}`,
      level: 'warn',
      title: t('{n}: не призначено {what}', { n: tr.number, what: !tr.vehicleId ? t('машину') : t('водія') }),
      text: t('Завантаження {date} · {from} → {to}', { date: date(tr.loadDate), from: tr.from.city, to: tr.to.city }),
      href: `/pages/trips.html?trip=${tr.id}`,
      task: { title: t('Призначити виконавців для {n}', { n: tr.number }), priority: 'high', dueDate: tr.loadDate, tripId: tr.id },
    });
  }

  // Прострочені завдання
  for (const task of tasks.filter((x) => x.status !== 'done' && x.dueDate && daysTo(x.dueDate) < 0)) {
    add({
      key: `task:${task.id}:${task.dueDate}`,
      level: 'warn',
      title: t('Прострочене завдання'),
      text: task.title,
      href: '/pages/kanban.html',
    });
  }

  // уже створені з нагадувань завдання — щоб не дублювати
  const titles = new Set(tasks.map((x) => x.title));
  out.forEach((r) => r.task && titles.has(r.task.title) && (r.taskExists = true));
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === 'bad' ? -1 : 1));
}

// ---------- Панель ----------
const SEEN_KEY = 'reminders.seen';
let items = [];

function ensurePanel() {
  if (document.getElementById('remindersDialog')) return;
  document.body.insertAdjacentHTML(
    'beforeend',
    `<dialog class="drawer reminders" id="remindersDialog" aria-labelledby="remindersTitle">
      <div class="trip-card">
        <header class="trip-card__head">
          <div>
            <h2 class="trip-card__title" id="remindersTitle">Нагадування</h2>
            <p class="trip-card__meta" id="remindersMeta"></p>
          </div>
          <button class="icon-btn trip-card__close" type="button" data-close aria-label="Закрити">${icons.close}</button>
        </header>
        <div class="trip-card__body"><ul class="reminders__list" id="remindersList"></ul></div>
      </div>
    </dialog>`
  );
  const dialog = document.getElementById('remindersDialog');
  dialog.addEventListener('click', async (e) => {
    if (e.target === dialog || e.target.closest('[data-close]')) return dialog.close();
    const btn = e.target.closest('[data-task]');
    if (!btn) return;
    const r = items[Number(btn.dataset.task)];
    btn.disabled = true;
    try {
      await createTask({ ...r.task, description: r.text, status: 'todo', order: 0 });
      r.taskExists = true;
      btn.outerHTML = `<span class="reminders__done">${icons.check}${t('Є в завданнях')}</span>`;
      showToast(t('Завдання створено: {title}', { title: r.task.title }));
    } catch (err) {
      btn.disabled = false;
      showToast(err.message, 'error');
    }
  });
}

function renderPanel() {
  const list = document.getElementById('remindersList');
  document.getElementById('remindersMeta').textContent = items.length
    ? t('Потребують уваги: {n}', { n: items.length })
    : t('Усе під контролем');
  list.innerHTML = items.length
    ? items
        .map(
          (r, i) => `
      <li class="reminder reminder--${r.level}">
        <span class="reminder__dot" aria-hidden="true"></span>
        <div class="reminder__body">
          <p class="reminder__title" data-no-i18n>${escapeHtml(r.title)}</p>
          <p class="reminder__text" data-no-i18n>${escapeHtml(r.text)}</p>
          <div class="reminder__actions">
            <a class="btn btn--text btn--sm" href="${r.href}">Відкрити</a>
            ${
              r.task
                ? r.taskExists
                  ? `<span class="reminders__done">${icons.check}${t('Є в завданнях')}</span>`
                  : `<button class="btn btn--ghost btn--sm" type="button" data-task="${i}">+ Завдання</button>`
                : ''
            }
          </div>
        </div>
      </li>`
        )
        .join('')
    : `<li class="docs__empty">Нагадувань немає — усі документи, оплати й ТО в порядку.</li>`;
}

/** Підключити кнопку нагадувань: badgeEls — лічильники в меню й на мобільній панелі */
export function initReminders({ buttons, badges }) {
  ensurePanel();
  const update = () => {
    const seen = new Set(load(SEEN_KEY) ?? []);
    const unseen = items.filter((r) => !seen.has(r.key)).length;
    badges.forEach((b) => {
      b.hidden = !unseen;
      b.textContent = unseen > 9 ? '9+' : unseen;
    });
  };
  const refresh = async () => {
    try {
      items = await collectReminders();
      update();
    } catch {
      // нагадування не критичні для роботи сторінки
    }
  };
  buttons.forEach((btn) =>
    btn.addEventListener('click', async () => {
      const dialog = document.getElementById('remindersDialog');
      document.getElementById('remindersList').innerHTML = '<li class="docs__empty">Перевіряємо…</li>';
      dialog.showModal();
      await refresh();
      renderPanel();
      save(SEEN_KEY, items.map((r) => r.key).slice(0, 300));
      update();
    })
  );
  // рахуємо після того, як сторінка вже показана
  (window.requestIdleCallback ?? ((fn) => setTimeout(fn, 600)))(refresh);
}

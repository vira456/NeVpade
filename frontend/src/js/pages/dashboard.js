// Аналітика: ключові показники за період, графіки доходів і витрат, оперативний стан
import { locale } from '../i18n/index.js';
// Лише потрібні частини Chart.js (замість chart.js/auto — бандл у ~2 рази менший)
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';
import { renderLayout } from '../utils/layout.js';
import { getSummary, getIncome, getExpenses } from '../api/analytics.js';
import { getTrips, myId, isOwner } from '../api/trips.js';
import { getDrivers } from '../api/drivers.js';
import { getVehicles } from '../api/vehicles.js';
import { getTasks } from '../api/tasks.js';
import { money, km, escapeHtml, compactMoney, VEHICLE_STATUS, paymentStatus, plural } from '../utils/format.js';
import { routeLine, statusBadge, shortDate } from '../utils/components.js';
import { icons } from '../utils/icons.js';
import { dueLabel, isOverdue } from './kanban/config.js';
import { t, i18nReady } from '../i18n/index.js';
import { countUpAll } from '../utils/motion.js';
import { showToast } from '../utils/toast.js';
import { setFieldError } from '../utils/validation.js';

renderLayout();

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip);

const PERIODS = {
  week: { title: 'Цей тиждень', prev: 'минулим тижнем' },
  month: { title: 'Цей місяць', prev: 'минулим місяцем' },
  year: { title: 'Цей рік', prev: 'минулим роком' },
};

const EXPENSE_LABELS = { fuel: 'Пальне', salary: 'Зарплата водіїв', repair: 'Ремонт і ТО', tolls: 'Дороги та стоянки', other: 'Інше' };

// Кольори графіка беремо з поточної теми (CSS-змінні); пари перевірені на дальтонізм
const COLORS = {};
function readColors() {
  const css = getComputedStyle(document.documentElement);
  const v = (name) => css.getPropertyValue(name).trim();
  Object.assign(COLORS, { income: v('--series-income'), expense: v('--series-expense'), grid: v('--border'), text: v('--muted'), ink: v('--text') });
}
readColors();

let period = 'month';
let chart = null;

// ---------- Показники ----------
function delta(current, previous, { lowerIsBetter = false } = {}) {
  if (!previous) return '';
  const pct = ((current - previous) / previous) * 100;
  const up = pct >= 0;
  const good = lowerIsBetter ? !up : up;
  const text = `${Math.abs(pct).toLocaleString(locale(), { maximumFractionDigits: 1 })} %`;
  return `<span class="ledger__delta ${good ? 'is-good' : 'is-bad'}">${up ? icons.arrowUp : icons.arrowDown}${text}</span>`;
}

function renderLedger(s) {
  const p = s.previous ?? {};
  // Мільйони скорочуємо, щоб число влізло в комірку; точне значення — у підказці
  const big = (n) => (Math.abs(n) >= 1e6 ? `<span title="${money(n)}">${compactMoney(n)} грн</span>` : money(n));
  const cells = [
    ['Дохід', big(s.income), delta(s.income, p.income)],
    ['Витрати', big(s.expenses), delta(s.expenses, p.expenses, { lowerIsBetter: true })],
    ['Прибуток', big(s.profit), delta(s.profit, p.profit)],
    ['Рейсів', s.tripsCount, delta(s.tripsCount, p.tripsCount)],
    ['Пробіг', km(s.distanceKm), delta(s.distanceKm, p.distanceKm)],
  ];
  const margin = s.income ? Math.round((s.profit / s.income) * 100) : 0;

  document.getElementById('ledger').innerHTML = cells
    .map(
      ([label, value, d]) => `
      <div class="ledger__cell">
        <span class="ledger__label">${label}</span>
        <strong class="ledger__value">${value}</strong>
        <span class="ledger__foot">${d}</span>
      </div>`
    )
    .join('');
  countUpAll(document.getElementById('ledger'), '.ledger__value');
  document.getElementById('marginNote').textContent = `Рентабельність ${margin} %`;
  document.getElementById('dashSubtitle').textContent = `${PERIODS[period].title} · зміни порівняно з ${PERIODS[period].prev}`;
}

// ---------- Графік доходів і витрат ----------
// Підписи серій біля останньої точки — щоб не шукати очима легенду
const endLabels = {
  id: 'endLabels',
  afterDatasetsDraw(c) {
    const { ctx } = c;
    ctx.save();
    ctx.font = "600 13px 'Manrope', 'Segoe UI', sans-serif";
    ctx.textBaseline = 'middle';
    const placed = [];
    c.data.datasets.forEach((ds, i) => {
      const meta = c.getDatasetMeta(i);
      // остання точка з даними (майбутні тижні/місяці — порожні)
      const last = [...meta.data].reverse().find((p, k) => ds.data[meta.data.length - 1 - k] != null);
      if (!last || meta.hidden) return;
      const width = ctx.measureText(ds.label).width;
      // підпис не виходить за край полотна й не накладається на сусідній
      const x = Math.min(last.x + 8, c.width - width - 2);
      let y = last.y;
      for (const p of placed) if (Math.abs(p - y) < 16) y = p + (y >= p ? 16 : -16);
      placed.push(y);
      ctx.fillStyle = COLORS.ink;
      ctx.fillText(ds.label, x, y);
    });
    ctx.restore();
  },
};

// Вертикальна лінія під курсором
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(c) {
    const active = c.tooltip?.getActiveElements?.();
    if (!active?.length) return;
    const x = active[0].element.x;
    const { top, bottom } = c.chartArea;
    c.ctx.save();
    c.ctx.strokeStyle = COLORS.text;
    c.ctx.globalAlpha = 0.35;
    c.ctx.beginPath();
    c.ctx.moveTo(x, top);
    c.ctx.lineTo(x, bottom);
    c.ctx.stroke();
    c.ctx.restore();
  },
};

function renderChart(data) {
  lastIncome = data;
  const datasets = [
    { label: t('Дохід'), data: data.income, borderColor: COLORS.income, backgroundColor: COLORS.income },
    { label: t('Витрати'), data: data.expenses, borderColor: COLORS.expense, backgroundColor: COLORS.expense },
  ].map((d) => ({
    ...d,
    borderWidth: 2,
    tension: 0.25,
    pointRadius: data.labels.length > 8 ? 0 : 3,
    pointHoverRadius: 5,
    pointHoverBorderWidth: 2,
    pointHoverBorderColor: '#fff',
  }));

  const labels = data.labels.map((l) => t(l));
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  } else {
    Chart.defaults.font.family = "'Manrope', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = COLORS.text;
    chart = new Chart(document.getElementById('incomeChart'), {
      type: 'line',
      data: { labels, datasets },
      plugins: [endLabels, crosshair],
      options: {
        maintainAspectRatio: false,
        layout: { padding: { right: 64, top: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false }, // власна легенда над графіком
          tooltip: {
            backgroundColor: '#23282d',
            padding: 10,
            cornerRadius: 4,
            boxPadding: 4,
            usePointStyle: true,
            titleFont: { weight: '600' },
            callbacks: { label: (c) => ` ${c.dataset.label}: ${money(c.parsed.y)}` },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: COLORS.grid } },
          y: {
            beginAtZero: true,
            border: { display: false },
            grid: { color: COLORS.grid },
            ticks: { callback: (v) => compactMoney(v), maxTicksLimit: 6 },
          },
        },
      },
    });
  }

  // Таблиця тих самих даних — для доступності та точних чисел
  document.getElementById('chartTable').innerHTML = `
    <table class="table">
      <thead><tr><th>Період</th><th class="num">Дохід</th><th class="num">Витрати</th><th class="num">Прибуток</th></tr></thead>
      <tbody>${data.labels
        .map(
          (l, i) =>
            data.income[i] == null
              ? `<tr><td>${l}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`
              : `<tr><td>${l}</td><td class="num">${money(data.income[i])}</td><td class="num">${money(data.expenses[i])}</td><td class="num">${money(
                  data.income[i] - data.expenses[i]
                )}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
}

// ---------- Структура витрат ----------
function renderExpenses(e) {
  const total = Object.values(e).reduce((a, b) => a + b, 0);
  const max = Math.max(...Object.values(e));
  document.getElementById('expensesTotal').textContent = money(total);
  document.getElementById('expenseBars').innerHTML = Object.entries(e)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([key, value]) => `
      <li class="bars__row" title="${EXPENSE_LABELS[key]}: ${money(value)}">
        <span class="bars__label">${EXPENSE_LABELS[key]}</span>
        <span class="bars__value">${compactMoney(value)} <small>${Math.round((value / total) * 100)} %</small></span>
        <span class="bars__track"><span class="bars__fill" data-w="${(value / max) * 100}"></span></span>
      </li>`
    )
    .join('');
  // смуги «виростають» з нуля
  requestAnimationFrame(() =>
    requestAnimationFrame(() =>
      document.querySelectorAll('.bars__fill').forEach((el) => (el.style.width = `${el.dataset.w}%`))
    )
  );
}

// ---------- Оперативний стан ----------
function renderActiveTrips(trips, drivers) {
  const list = trips
    .filter((t) => t.managerId === myId())
    .filter((t) => t.status === 'in_progress' || t.status === 'planned')
    .sort((a, b) => (a.status === b.status ? a.loadDate.localeCompare(b.loadDate) : a.status === 'in_progress' ? -1 : 1));

  document.getElementById('activeCount').textContent = list.length;
  document.getElementById('activeTrips').innerHTML = list.length
    ? list
        .map((t, i) => {
          const driver = drivers.find((d) => d.id === t.driverId);
          return `
          <li class="trip-row">
            <a class="trip-row__link" href="/pages/trips.html?trip=${t.id}" style="--i:${i}">
              <span class="trip-row__id"><strong>${escapeHtml(t.number)}</strong><span>${shortDate(t.loadDate)}</span></span>
              ${routeLine(t, { size: 'draw' })}
              <span class="trip-row__driver">${driver ? escapeHtml(driver.name) : '—'}</span>
              ${statusBadge(t.status)}
            </a>
          </li>`;
        })
        .join('')
    : '<li class="empty"><p class="empty__title">Активних рейсів немає</p><p>Нові рейси з’являться тут після планування.</p></li>';
}

function renderTasks(tasks) {
  const list = tasks
    .filter((t) => t.status !== 'done')
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'))
    .slice(0, 4);
  const overdue = tasks.filter(isOverdue).length;
  document.getElementById('tasksNote').textContent = overdue ? `${overdue} прострочено` : '';

  document.getElementById('upcomingTasks').innerHTML = list.length
    ? list
        .map((t) => {
          const due = dueLabel(t);
          return `<li class="mini-task">
            <span class="mini-task__dot mini-task__dot--${t.priority}" aria-hidden="true"></span>
            <span class="mini-task__title">${escapeHtml(t.title)}</span>
            ${due ? `<span class="due due--${due.tone}">${escapeHtml(due.text)}</span>` : ''}
          </li>`;
        })
        .join('')
    : '<li class="empty"><p class="empty__title">Усе виконано</p></li>';
}

function renderFleet(vehicles) {
  const order = ['loading', 'on_trip', 'unloaded', 'available', 'broken', 'repair'];
  const counts = Object.fromEntries(order.map((s) => [s, vehicles.filter((v) => v.status === s).length]));
  document.getElementById('fleetBar').innerHTML = order
    .filter((s) => counts[s])
    .map((s) => `<span class="fleet-bar__seg fleet-bar__seg--${s}" style="flex:${counts[s]}" title="${t(VEHICLE_STATUS[s])}: ${counts[s]}"></span>`)
    .join('');
  // у легенді — лише стани, які зараз є (+ «вільна» завжди)
  document.getElementById('fleetLegend').innerHTML = order
    .filter((s) => counts[s] || s === 'available')
    .map((s) => `<li><span class="badge badge--${s}">${VEHICLE_STATUS[s]}</span><strong>${counts[s]}</strong></li>`)
    .join('');
}

// Оплати: керівник бачить усю компанію, менеджер — свої рейси
function renderPayments(trips) {
  const mine = trips.filter((tr) => isOwner() || tr.managerId === myId());
  const sum = (st) => {
    const list = mine.filter((tr) => paymentStatus(tr) === st);
    return { n: list.length, total: list.reduce((a, tr) => a + (tr.price || 0), 0) };
  };
  const pending = sum('pending');
  const overdue = sum('overdue');
  const scope = isOwner() ? '' : '&scope=mine';
  document.getElementById('paySummary').innerHTML = `
    <a class="pay-sum__row" href="/pages/trips.html?pay=pending${scope}">
      <dt><span class="badge badge--pending">Очікує оплати</span></dt>
      <dd><strong>${money(pending.total)}</strong><span>${t(plural(pending.n, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n: pending.n })}</span></dd>
    </a>
    <a class="pay-sum__row ${overdue.n ? 'is-bad' : ''}" href="/pages/trips.html?pay=overdue${scope}">
      <dt><span class="badge badge--overdue">Прострочено</span></dt>
      <dd><strong>${money(overdue.total)}</strong><span>${t(plural(overdue.n, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n: overdue.n })}</span></dd>
    </a>`;
}

// ---------- Період ----------
async function loadPeriod(p) {
  period = p;
  document.querySelectorAll('#periodSwitch .seg__btn').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.period === p)));
  const [summary, income, expenses] = await Promise.all([getSummary(p), getIncome(p), getExpenses(p)]);
  renderLedger(summary);
  renderChart(income);
  renderExpenses(expenses);
}

document.getElementById('periodSwitch').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-period]');
  if (btn && btn.dataset.period !== period) loadPeriod(btn.dataset.period);
});

// ---------- Звіт в Excel ----------
const reportDialog = document.getElementById('reportDialog');
const reportFrom = document.getElementById('reportFrom');
const reportTo = document.getElementById('reportTo');
const PERIOD_PRESET = { week: 'week', month: 'month', year: 'year' };

async function setPreset(preset) {
  const { presetRange } = await import('../utils/finance-report.js');
  const r = presetRange(preset);
  reportFrom.value = r.from;
  reportTo.value = r.to;
}

document.getElementById('excelReport').addEventListener('click', async () => {
  const preset = PERIOD_PRESET[period] ?? 'month';
  reportDialog.querySelector(`[name=preset][value="${preset}"]`).checked = true;
  await setPreset(preset);
  setFieldError(reportTo, '');
  reportDialog.showModal();
});
reportDialog.addEventListener('change', (e) => {
  if (e.target.name === 'preset') setPreset(e.target.value);
  // дати змінили вручну — жоден готовий період уже не відповідає
  if (e.target === reportFrom || e.target === reportTo) reportDialog.querySelectorAll('[name=preset]').forEach((r) => (r.checked = false));
});
reportDialog.addEventListener('click', (e) => {
  if (e.target === reportDialog || e.target.closest('[data-cancel]')) reportDialog.close();
});
document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  setFieldError(reportTo, '');
  if (!reportFrom.value || !reportTo.value) return setFieldError(reportTo, 'Вкажіть обидві дати');
  if (reportTo.value < reportFrom.value) return setFieldError(reportTo, 'Кінець періоду раніше за початок');
  const btn = document.getElementById('reportSubmit');
  btn.disabled = true;
  try {
    const { downloadFinanceReport } = await import('../utils/finance-report.js');
    const res = await downloadFinanceReport({ from: reportFrom.value, to: reportTo.value });
    reportDialog.close();
    showToast(res.trips ? t('Звіт завантажено: {trips}, дохід {sum}', { trips: t(plural(res.trips, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n: res.trips }), sum: money(res.income) }) : t('Звіт завантажено, але за цей період рейсів немає'));
  } catch (err) {
    showToast(err.message || t('Не вдалося сформувати звіт'), 'error');
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('chartTableToggle').addEventListener('click', (e) => {
  const table = document.getElementById('chartTable');
  table.hidden = !table.hidden;
  e.currentTarget.textContent = table.hidden ? 'Показати таблицею' : 'Сховати таблицю';
  e.currentTarget.setAttribute('aria-expanded', String(!table.hidden));
});

async function init() {
  // усі запити — одночасно, а не двома хвилями
  const operational = Promise.all([getTrips(), getDrivers(), getVehicles(), getTasks()]).then(([trips, drivers, vehicles, tasks]) => {
    renderActiveTrips(trips, drivers);
    renderTasks(tasks);
    renderFleet(vehicles);
    renderPayments(trips);
  });
  await Promise.all([operational, i18nReady.then(() => loadPeriod(period))]);
}

// Зміна теми — перемальовуємо графік новими кольорами
let lastIncome = null;
window.addEventListener('themechange', () => {
  readColors();
  if (!chart || !lastIncome) return;
  Chart.defaults.color = COLORS.text;
  chart.options.scales.x.border.color = COLORS.grid;
  chart.options.scales.y.grid.color = COLORS.grid;
  renderChart(lastIncome);
});

init();

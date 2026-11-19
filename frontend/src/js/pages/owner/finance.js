// Кабінет власника → Фінанси: дохід, витрати, прибуток, структура витрат, клієнти, звіт в Excel
import { Chart, BarController, BarElement, LinearScale, CategoryScale, Tooltip } from 'chart.js';
import { renderLayout } from '../../utils/layout.js';
import { getSummary, getIncome, getExpenses, periodRange } from '../../api/analytics.js';
import { getTrips } from '../../api/trips.js';
import { money, compactMoney, escapeHtml, plural, paymentStatus } from '../../utils/format.js';
import { countUpAll } from '../../utils/motion.js';
import { showToast } from '../../utils/toast.js';
import { t, i18nReady } from '../../i18n/index.js';
import { $, delta, big, bindPeriod, renderCompanyLine } from './common.js';

Chart.register(BarController, BarElement, LinearScale, CategoryScale, Tooltip);

const EXPENSE_LABELS = { fuel: 'Пальне', salary: 'Зарплата водіїв', repair: 'Ремонт і ТО', tolls: 'Дороги та стоянки', other: 'Інше' };
let period = 'month';
let trips = [];
let chart = null;

const colors = () => {
  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  return { income: v('--series-income'), expense: v('--series-expense'), grid: v('--border'), text: v('--muted') };
};

function renderLedger(s) {
  const p = s.previous ?? {};
  const margin = s.income ? Math.round((s.profit / s.income) * 100) : null;
  const prevMargin = p.income ? Math.round((p.profit / p.income) * 100) : null;
  const cells = [
    ['Дохід', big(s.income), delta(s.income, p.income)],
    ['Витрати', big(s.expenses), delta(s.expenses, p.expenses)],
    ['Прибуток', big(s.profit), delta(s.profit, p.profit)],
    [
      'Рентабельність',
      margin == null ? '—' : `${margin} %`,
      margin != null && prevMargin != null ? t('було {n} %', { n: prevMargin }) : '',
    ],
  ];
  $('financeLedger').innerHTML = cells
    .map(
      ([label, value, foot]) => `
      <div class="ledger__cell">
        <span class="ledger__label">${label}</span>
        <strong class="ledger__value">${value}</strong>
        <span class="ledger__foot">${foot}</span>
      </div>`
    )
    .join('');
  countUpAll($('financeLedger'), '.ledger__value');
  $('marginNote').textContent = margin == null ? '' : t('прибуток — {n} % доходу', { n: margin });
}

function renderChart(data) {
  const c = colors();
  const labels = data.labels.map((l) => t(l));
  const datasets = [
    { label: t('Дохід'), data: data.income, backgroundColor: c.income, borderRadius: 4, maxBarThickness: 28 },
    { label: t('Витрати'), data: data.expenses, backgroundColor: c.expense, borderRadius: 4, maxBarThickness: 28 },
  ];
  if (chart) {
    chart.data.labels = labels;
    chart.data.datasets = datasets;
    chart.update();
  } else {
    Chart.defaults.font.family = "'Manrope', 'Segoe UI', system-ui, sans-serif";
    Chart.defaults.color = c.text;
    chart = new Chart($('financeChart'), {
      type: 'bar',
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { backgroundColor: '#23282d', padding: 10, cornerRadius: 4, callbacks: { label: (x) => ` ${x.dataset.label}: ${money(x.parsed.y)}` } },
        },
        scales: {
          x: { grid: { display: false }, border: { color: c.grid } },
          y: { beginAtZero: true, border: { display: false }, grid: { color: c.grid }, ticks: { callback: (v) => compactMoney(v), maxTicksLimit: 6 } },
        },
      },
    });
  }
  // ті самі числа таблицею — для точності й доступності
  $('financeTable').innerHTML = `
    <table class="table">
      <thead><tr><th>${t('Період')}</th><th class="num">${t('Дохід')}</th><th class="num">${t('Витрати')}</th><th class="num">${t('Прибуток')}</th></tr></thead>
      <tbody>${data.labels
        .map((l, i) =>
          data.income[i] == null
            ? `<tr><td>${t(l)}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`
            : `<tr><td>${t(l)}</td><td class="num">${money(data.income[i])}</td><td class="num">${money(data.expenses[i])}</td><td class="num">${money(data.income[i] - data.expenses[i])}</td></tr>`
        )
        .join('')}</tbody>
    </table>`;
}

function renderExpenses(e) {
  const total = Object.values(e).reduce((a, b) => a + (b || 0), 0);
  const max = Math.max(...Object.values(e));
  $('expensesTotal').textContent = money(total);
  $('financeBars').innerHTML = Object.entries(e)
    .sort((a, b) => b[1] - a[1])
    .map(
      ([key, value]) => `
      <li class="bars__row" title="${EXPENSE_LABELS[key]}: ${money(value)}">
        <span class="bars__label">${EXPENSE_LABELS[key]}</span>
        <span class="bars__value">${compactMoney(value)} <small>${total ? Math.round((value / total) * 100) : 0} %</small></span>
        <span class="bars__track"><span class="bars__fill" style="width:${max ? (value / max) * 100 : 0}%"></span></span>
      </li>`
    )
    .join('');
}

// Клієнти за період: рейси й дохід; «не оплачено» — увесь борг клієнта, прострочене — червоним
function renderClients() {
  const { from, to } = periodRange(period);
  const inPeriod = (tr) => ['done', 'in_progress'].includes(tr.status) && new Date(tr.loadDate) >= from && new Date(tr.loadDate) < to;
  const rows = new Map();
  for (const tr of trips) {
    const key = tr.clientId ?? tr.client?.name ?? '—';
    const r = rows.get(key) ?? { name: tr.client?.name ?? '—', trips: 0, income: 0, unpaid: 0, overdue: 0 };
    if (inPeriod(tr)) {
      r.trips += 1;
      r.income += tr.price || 0;
    }
    const pay = paymentStatus(tr);
    if (pay === 'pending' || pay === 'overdue') r.unpaid += tr.price || 0;
    if (pay === 'overdue') r.overdue += tr.price || 0;
    rows.set(key, r);
  }
  const list = [...rows.values()].filter((r) => r.trips || r.unpaid).sort((a, b) => b.income - a.income || b.unpaid - a.unpaid);
  $('clientsBody').innerHTML = list.length
    ? list
        .slice(0, 10)
        .map(
          (r) => `<tr>
        <td data-no-i18n>${escapeHtml(r.name)}</td>
        <td class="num">${r.trips}</td>
        <td class="num">${money(r.income)}</td>
        <td class="num">${r.unpaid ? `<span class="${r.overdue ? 'owner-debt' : ''}" title="${r.overdue ? escapeHtml(t('з них прострочено {sum}', { sum: money(r.overdue) })) : ''}">${money(r.unpaid)}</span>` : '—'}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="4"><div class="empty"><p>${t('За цей період рейсів немає')}</p></div></td></tr>`;
}

async function load() {
  try {
    const [summary, income, expenses] = await Promise.all([getSummary(period), getIncome(period), getExpenses(period)]);
    renderLedger(summary);
    renderChart(income);
    renderExpenses(expenses);
  } catch (err) {
    showToast(t('Не вдалося порахувати показники: {msg}', { msg: err.message }), 'error');
  }
  renderClients();
}

function bindEvents() {
  bindPeriod('financePeriod', (p) => {
    period = p;
    load();
  });
  $('financeTableToggle').addEventListener('click', (e) => {
    const open = $('financeTable').hidden;
    $('financeTable').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
    e.currentTarget.textContent = t(open ? 'Сховати таблицю' : 'Показати таблицею');
  });
  $('financeReport').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const { downloadFinanceReport, presetRange } = await import('../../utils/finance-report.js');
      const res = await downloadFinanceReport(presetRange(period));
      showToast(
        res.trips
          ? t('Звіт завантажено: {trips}, дохід {sum}', { trips: t(plural(res.trips, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n: res.trips }), sum: money(res.income) })
          : t('Звіт завантажено, але за цей період рейсів немає')
      );
    } catch (err) {
      showToast(err.message || t('Не вдалося сформувати звіт'), 'error');
    } finally {
      btn.disabled = false;
    }
  });
  // тема змінилась — перемальовуємо графік у нових кольорах
  window.addEventListener('themechange', () => {
    if (!chart) return;
    const c = colors();
    chart.data.datasets[0].backgroundColor = c.income;
    chart.data.datasets[1].backgroundColor = c.expense;
    chart.options.scales.y.grid.color = c.grid;
    chart.update();
  });
}

async function init() {
  renderCompanyLine();
  trips = await getTrips().catch(() => []);
  await i18nReady;
  await load();
}

if (renderLayout({ access: 'owner' })) {
  bindEvents();
  init();
}

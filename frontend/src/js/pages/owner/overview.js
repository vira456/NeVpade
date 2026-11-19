// Кабінет власника → Огляд: компанія загалом, рейтинг менеджерів і що потребує уваги
import { renderLayout } from '../../utils/layout.js';
import { getTeamStats } from '../../api/analytics.js';
import { getMembers, getJoinRequests } from '../../api/company.js';
import { getTrips } from '../../api/trips.js';
import { money, escapeHtml, plural, paymentStatus } from '../../utils/format.js';
import { avatar } from '../../utils/people.js';
import { countUpAll } from '../../utils/motion.js';
import { showToast } from '../../utils/toast.js';
import { t } from '../../i18n/index.js';
import { $, delta, big, bindPeriod, renderCompanyLine, showOwnerCode } from './common.js';

let members = [];
let trips = [];
let stats = null;
let requests = [];

const tripsWord = (n) => t(plural(n, ['{n} рейс', '{n} рейси', '{n} рейсів']), { n });
const memberHref = (id) => `/pages/member.html?id=${encodeURIComponent(id)}`;

function renderLedger() {
  const s = stats;
  const p = s.previous ?? {};
  const pay = s.payments ?? {};
  const cells = [
    ['Дохід', big(s.income), delta(s.income, p.income)],
    ['Прибуток', big(s.profit), delta(s.profit, p.profit)],
    ['Рейсів', s.tripsCount ?? '—', delta(s.tripsCount, p.tripsCount)],
    ['Чекає оплати', big(pay.pending), pay.pendingCount ? tripsWord(pay.pendingCount) : ''],
    ['Прострочено клієнтами', big(pay.overdue), pay.overdueCount ? tripsWord(pay.overdueCount) : t('боргів немає')],
  ];
  $('ownerLedger').innerHTML = cells
    .map(
      ([label, value, foot], i) => `
      <div class="ledger__cell ${i === 4 && pay.overdueCount ? 'is-alert' : ''}">
        <span class="ledger__label">${label}</span>
        <strong class="ledger__value">${value}</strong>
        <span class="ledger__foot">${foot}</span>
      </div>`
    )
    .join('');
  countUpAll($('ownerLedger'), '.ledger__value');
}

function renderRank() {
  const byId = new Map((stats.managers ?? []).map((x) => [String(x.managerId), x]));
  const managers = members.filter((m) => m.role !== 'owner');
  const rows = managers.map((m) => ({ m, s: byId.get(m.id) ?? {} })).sort((a, b) => (b.s.income ?? 0) - (a.s.income ?? 0));
  const max = Math.max(1, ...rows.map((r) => r.s.income ?? 0));
  $('rankList').innerHTML = rows.length
    ? rows
        .slice(0, 6)
        .map(
          ({ m, s }) => `
        <li class="rank__row">
          <a class="rank__who" href="${memberHref(m.id)}">${avatar(m, { size: 34 })}<span class="rank__name" data-no-i18n>${escapeHtml(m.name)}</span></a>
          <span class="rank__bar" aria-hidden="true"><span style="width:${Math.round(((s.income ?? 0) / max) * 100)}%"></span></span>
          <span class="rank__value">${money(s.income ?? 0)}<small>${tripsWord(s.tripsCount ?? 0)}</small></span>
        </li>`
        )
        .join('')
    : `<li class="rank__empty">${t('Менеджерів ще немає — дайте їм код запрошення на сторінці «Менеджери».')}</li>`;
}

// Прострочені оплати (за клієнтами) і менеджери без жодного активного рейсу
function renderAttention() {
  const name = (id) => members.find((m) => m.id === id)?.name ?? '—';
  const overdue = trips.filter((tr) => paymentStatus(tr) === 'overdue');
  const byClient = new Map();
  for (const tr of overdue) {
    const key = tr.clientId ?? tr.client?.name;
    const row = byClient.get(key) ?? { client: tr.client?.name ?? '—', sum: 0, n: 0, days: 0, managers: new Set() };
    row.sum += tr.price || 0;
    row.n += 1;
    row.days = Math.max(row.days, Math.floor((Date.now() - new Date(tr.payment.dueDate)) / 864e5));
    row.managers.add(name(tr.managerId));
    byClient.set(key, row);
  }
  const debts = [...byClient.values()].sort((a, b) => b.sum - a.sum).slice(0, 5);
  const idle = members.filter((m) => m.role !== 'owner' && !trips.some((tr) => tr.managerId === m.id && ['planned', 'in_progress'].includes(tr.status)));

  const items = [
    ...(requests.length
      ? [
          `<li class="attention__item is-new">
        <a class="attention__title" href="/pages/owner-team.html">${t(plural(requests.length, ['{n} заявка на вступ', '{n} заявки на вступ', '{n} заявок на вступ']), { n: requests.length })}</a>
        <span class="attention__value">${t('чекає рішення')}</span>
        <span class="attention__meta" data-no-i18n>${escapeHtml(requests.map((r) => r.name).join(', '))}</span>
      </li>`,
        ]
      : []),
    ...debts.map(
      (d) => `
      <li class="attention__item is-bad">
        <span class="attention__title" data-no-i18n>${escapeHtml(d.client)}</span>
        <span class="attention__value">${money(d.sum)}</span>
        <span class="attention__meta">${t('прострочено {n} дн.', { n: d.days })} · ${tripsWord(d.n)} · <span data-no-i18n>${escapeHtml([...d.managers].join(', '))}</span></span>
      </li>`
    ),
    ...idle.map(
      (m) => `
      <li class="attention__item">
        <a class="attention__title" href="${memberHref(m.id)}" data-no-i18n>${escapeHtml(m.name)}</a>
        <span class="attention__value">${t('без рейсів')}</span>
        <span class="attention__meta">${t('немає запланованих чи активних рейсів')}</span>
      </li>`
    ),
  ];
  $('attentionList').innerHTML = items.length ? items.join('') : `<li class="attention__empty">${t('Усе гаразд: прострочених оплат немає, усі менеджери з рейсами.')}</li>`;
}

async function load(period) {
  try {
    stats = await getTeamStats(period);
  } catch (err) {
    stats = { managers: [], previous: {}, payments: {} };
    showToast(t('Не вдалося порахувати показники: {msg}', { msg: err.message }), 'error');
  }
  renderLedger();
  renderRank();
}

async function init() {
  renderCompanyLine();
  const soft = (p, fallback) => p.catch(() => fallback);
  [members, trips, requests, stats] = await Promise.all([
    soft(getMembers(), []),
    soft(getTrips(), []),
    soft(getJoinRequests(), []),
    getTeamStats('month').catch(() => ({ managers: [], previous: {}, payments: {} })),
  ]);
  renderLedger();
  renderRank();
  renderAttention();
}

if (renderLayout({ access: 'owner' })) {
  showOwnerCode(); // щойно зареєструвався чи перевипустив код — показуємо один раз
  bindPeriod('ownerPeriod', load);
  init();
}

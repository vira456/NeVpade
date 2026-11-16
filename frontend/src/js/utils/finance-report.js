// Фінансовий звіт у Excel: доходи, витрати, прибуток за обраний період.
// Рахується з тих самих даних, що й аналітика (рейси «Виконано» і «В дорозі» за датою завантаження),
// тож працює і з моками, і з бекендом — окремий ендпоінт не потрібен.
import { getTrips } from '../api/trips.js';
import { getVehicles } from '../api/vehicles.js';
import { getDrivers } from '../api/drivers.js';
import { getClients } from '../api/clients.js';
import { getCompany, getMembers } from '../api/company.js';
import { getCurrentUser } from '../api/auth.js';
import { tripCosts, FUEL_PRICE, REPAIR_PER_KM, TOLLS_PER_KM, OTHER_PER_TRIP } from './economics.js';
import { paymentStatus, PAYMENT_STATUS, TRIP_STATUS } from './format.js';
import { buildXlsx, downloadBlob, colName } from './xlsx.js';
import { t, locale } from '../i18n/index.js';

const COUNTED = ['done', 'in_progress'];
const DAY = 864e5;
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => new Date(`${s}T00:00:00`);
const human = (s) => parse(s).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' });

/** Готові періоди для діалогу. Повертає { from, to } — обидві дати включно, 'YYYY-MM-DD' */
export function presetRange(preset, today = new Date()) {
  const y = today.getFullYear();
  const m = today.getMonth();
  const r = (a, b) => ({ from: ymd(a), to: ymd(b) });
  switch (preset) {
    case 'week': {
      const mon = new Date(y, m, today.getDate() - ((today.getDay() + 6) % 7));
      return r(mon, new Date(mon.getTime() + 6 * DAY));
    }
    case 'last-month':
      return r(new Date(y, m - 1, 1), new Date(y, m, 0));
    case 'quarter': {
      const q = Math.floor(m / 3) * 3;
      return r(new Date(y, q, 1), new Date(y, q + 3, 0));
    }
    case 'year':
      return r(new Date(y, 0, 1), new Date(y, 11, 31));
    case 'last-year':
      return r(new Date(y - 1, 0, 1), new Date(y - 1, 11, 31));
    default: // month
      return r(new Date(y, m, 1), new Date(y, m + 1, 0));
  }
}

// Попередній період такої самої довжини — для колонки «Зміна»
function previousRange(from, to) {
  const days = Math.round((parse(to) - parse(from)) / DAY) + 1;
  const a = parse(from);
  const b = parse(to);
  // цілий місяць / рік → попередній місяць / рік (а не «ті самі 30 днів»)
  const wholeMonth = a.getDate() === 1 && new Date(b.getTime() + DAY).getDate() === 1 && a.getMonth() === b.getMonth();
  const wholeYear = from.endsWith('-01-01') && to.endsWith('-12-31') && a.getFullYear() === b.getFullYear();
  if (wholeYear) return { from: `${a.getFullYear() - 1}-01-01`, to: `${a.getFullYear() - 1}-12-31` };
  if (wholeMonth) return { from: ymd(new Date(a.getFullYear(), a.getMonth() - 1, 1)), to: ymd(new Date(a.getFullYear(), a.getMonth(), 0)) };
  return { from: ymd(new Date(a.getTime() - days * DAY)), to: ymd(new Date(a.getTime() - DAY)) };
}

// Відрізки для аркуша «Динаміка»: до 2 тижнів — дні, до 3 місяців — тижні, далі — місяці
function buckets(from, to) {
  const a = parse(from);
  const b = parse(to);
  const days = Math.round((b - a) / DAY) + 1;
  const out = [];
  const label = (x, y) =>
    x === y ? human(x) : `${parse(x).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })}–${human(y)}`;
  if (days <= 14) {
    for (let d = a; d <= b; d = new Date(d.getTime() + DAY)) out.push({ from: ymd(d), to: ymd(d), label: human(ymd(d)) });
  } else if (days <= 92) {
    for (let d = a; d <= b; d = new Date(d.getTime() + 7 * DAY)) {
      const end = new Date(Math.min(d.getTime() + 6 * DAY, b.getTime()));
      out.push({ from: ymd(d), to: ymd(end), label: label(ymd(d), ymd(end)) });
    }
  } else {
    for (let d = new Date(a.getFullYear(), a.getMonth(), 1); d <= b; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const start = d < a ? a : d;
      const endM = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const end = endM > b ? b : endM;
      const name = d.toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
      const clean = name.replace(/\s*р\.$/, ''); // «листопад 2026 р.» → «Листопад 2026»
      out.push({ from: ymd(start), to: ymd(end), label: clean.charAt(0).toUpperCase() + clean.slice(1) });
    }
  }
  return out;
}

const inRange = (trip, from, to) => COUNTED.includes(trip.status) && trip.loadDate >= from && trip.loadDate <= to;

// Підсумок рядків: дохід, витрати, рейси, км
function sum(rows) {
  return rows.reduce(
    (s, r) => ({
      income: s.income + (r.trip.price || 0),
      expenses: s.expenses + r.cost.total,
      trips: s.trips + 1,
      km: s.km + (r.trip.distanceKm || 0),
    }),
    { income: 0, expenses: 0, trips: 0, km: 0 }
  );
}

// Рядок «Разом» з формулами SUM для вказаних колонок
function totalRow(width, firstRow, lastRow, sumCols, extra = {}) {
  const row = Array(width).fill(null);
  row[0] = { v: t('Разом'), s: 'total' };
  for (let c = 1; c < width; c++) row[c] = { v: '', s: 'total' };
  for (const [c, style] of Object.entries(sumCols)) {
    const L = colName(Number(c));
    row[c] = lastRow >= firstRow ? { f: `SUM(${L}${firstRow}:${L}${lastRow})`, s: style } : { v: 0, s: style };
  }
  Object.assign(row, extra);
  return row;
}

const head = (labels) => labels.map((l) => ({ v: t(l), s: 'head' }));

/** Сформувати й завантажити звіт за період from…to (включно) */
export async function downloadFinanceReport({ from, to }) {
  const [trips, vehicles, drivers, clients, company, members] = await Promise.all([
    getTrips(),
    getVehicles(),
    getDrivers(),
    getClients(),
    getCompany(),
    getMembers(),
  ]);
  const vehicleOf = (tr) => vehicles.find((v) => v.id === tr.vehicleId);
  const driverOf = (tr) => drivers.find((d) => d.id === tr.driverId);
  const withCost = (list) => list.map((trip) => ({ trip, cost: tripCosts(trip, vehicleOf(trip), driverOf(trip)) }));

  const rows = withCost(trips.filter((tr) => inRange(tr, from, to))).sort(
    (a, b) => a.trip.loadDate.localeCompare(b.trip.loadDate) || a.trip.number.localeCompare(b.trip.number)
  );
  // Період ще не закінчився (напр. «Цей рік» у листопаді) — порівнюємо з тим самим відрізком
  // попереднього періоду, інакше будь-який незавершений рік виглядає як падіння
  const today = ymd(new Date());
  const prev = previousRange(from, to);
  if (to > today && from <= today) {
    const elapsed = Math.round((parse(today) - parse(from)) / DAY);
    const cut = ymd(new Date(parse(prev.from).getTime() + elapsed * DAY));
    if (cut < prev.to) prev.to = cut;
  }
  const prevRows = withCost(trips.filter((tr) => inRange(tr, prev.from, prev.to)));
  const cur = sum(rows);
  const old = sum(prevRows);
  const period = `${human(from)} – ${human(to)}`;
  const me = getCurrentUser()?.name ?? '';

  // ---------- 1. Зведення ----------
  const S = [];
  S.push([{ v: t('Фінансовий звіт · {company}', { company: company.name }), s: 'title' }]);
  S.push([{ v: t('Період: {period}', { period }), s: 'bold' }]);
  S.push([{ v: t('Порівняння з: {period}', { period: `${human(prev.from)} – ${human(prev.to)}` }), s: 'muted' }]);
  S.push([
    {
      v: t('Сформовано {date}{who}', {
        date: new Date().toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        who: me ? ` · ${me}` : '',
      }),
      s: 'muted',
    },
  ]);
  S.push([]);
  S.push(head(['Показник', 'Цей період', 'Попередній період', 'Зміна']));
  const k = S.length + 1; // перший рядок показників (номер рядка в Excel)
  const change = (r) => ({ f: `IF(C${r}=0,"",B${r}/C${r}-1)`, s: 'percent' });
  S.push([t('Дохід, грн'), { v: cur.income, s: 'money' }, { v: old.income, s: 'money' }, change(k)]);
  S.push([t('Витрати, грн'), { v: cur.expenses, s: 'money' }, { v: old.expenses, s: 'money' }, change(k + 1)]);
  S.push([{ v: t('Прибуток, грн'), s: 'bold' }, { f: `B${k}-B${k + 1}`, s: 'money' }, { f: `C${k}-C${k + 1}`, s: 'money' }, change(k + 2)]);
  S.push([t('Рентабельність'), { f: `IF(B${k}=0,0,B${k + 2}/B${k})`, s: 'percent' }, { f: `IF(C${k}=0,0,C${k + 2}/C${k})`, s: 'percent' }, null]);
  S.push([t('Рейсів'), { v: cur.trips, s: 'number' }, { v: old.trips, s: 'number' }, change(k + 4)]);
  S.push([t('Пробіг, км'), { v: cur.km, s: 'number' }, { v: old.km, s: 'number' }, change(k + 5)]);
  S.push([t('Середній дохід за рейс, грн'), { f: `IF(B${k + 4}=0,0,B${k}/B${k + 4})`, s: 'money' }, { f: `IF(C${k + 4}=0,0,C${k}/C${k + 4})`, s: 'money' }, change(k + 6)]);
  S.push([t('Дохід на 1 км, грн'), { f: `IF(B${k + 5}=0,0,B${k}/B${k + 5})`, s: 'money' }, { f: `IF(C${k + 5}=0,0,C${k}/C${k + 5})`, s: 'money' }, change(k + 7)]);

  S.push([]);
  S.push([{ v: t('Структура витрат'), s: 'bold' }]);
  S.push(head(['Стаття', 'Сума, грн', 'Частка']));
  const EXP = [
    ['fuel', 'Пальне'],
    ['salary', 'Зарплата водіїв'],
    ['repair', 'Ремонт і ТО'],
    ['tolls', 'Дороги та стоянки'],
    ['other', 'Інше'],
  ];
  const e0 = S.length + 1;
  const eTotal = e0 + EXP.length;
  EXP.forEach(([key, label], i) =>
    S.push([t(label), { v: rows.reduce((s, r) => s + r.cost[key], 0), s: 'money' }, { f: `IF(B${eTotal}=0,0,B${e0 + i}/B${eTotal})`, s: 'percent' }])
  );
  S.push([{ v: t('Разом'), s: 'total' }, { f: `SUM(B${e0}:B${eTotal - 1})`, s: 'totalMoney' }, { f: `IF(B${eTotal}=0,0,1)`, s: 'totalPercent' }]);

  S.push([]);
  S.push([{ v: t('Оплати клієнтів за рейси періоду'), s: 'bold' }]);
  S.push(head(['Стан', 'Рейсів', 'Сума, грн']));
  const p0 = S.length + 1;
  const PAY = ['paid', 'pending', 'overdue'];
  PAY.forEach((p) => {
    const list = rows.filter((r) => paymentStatus(r.trip) === p);
    S.push([t(PAYMENT_STATUS[p]), { v: list.length, s: 'number' }, { v: list.reduce((s, r) => s + r.trip.price, 0), s: 'money' }]);
  });
  S.push([{ v: t('Разом'), s: 'total' }, { f: `SUM(B${p0}:B${p0 + 2})`, s: 'totalNumber' }, { f: `SUM(C${p0}:C${p0 + 2})`, s: 'totalMoney' }]);

  S.push([]);
  S.push([
    {
      v: t('Враховано рейси зі статусом «Виконано» і «В дорозі» за датою завантаження. Витрати — за нормативами: пальне {fuel} грн/л, ремонт і ТО {repair} грн/км, дороги {tolls} грн/км, інше {other} грн на рейс.', {
        fuel: FUEL_PRICE,
        repair: String(REPAIR_PER_KM).replace('.', ','),
        tolls: String(TOLLS_PER_KM).replace('.', ','),
        other: OTHER_PER_TRIP,
      }),
      s: 'muted',
    },
  ]);

  // ---------- 2. Динаміка ----------
  const D = [head(['Період', 'Дохід, грн', 'Витрати, грн', 'Прибуток, грн', 'Рентабельність', 'Рейсів', 'Пробіг, км'])];
  for (const b of buckets(from, to).filter((x) => x.from <= today)) {
    const s = sum(rows.filter((r) => r.trip.loadDate >= b.from && r.trip.loadDate <= b.to));
    const r = D.length + 1;
    D.push([
      b.label,
      { v: s.income, s: 'money' },
      { v: s.expenses, s: 'money' },
      { f: `B${r}-C${r}`, s: 'money' },
      { f: `IF(B${r}=0,0,D${r}/B${r})`, s: 'percent' },
      { v: s.trips, s: 'number' },
      { v: s.km, s: 'number' },
    ]);
  }
  const dl = D.length;
  D.push(
    totalRow(7, 2, dl, { 1: 'totalMoney', 2: 'totalMoney', 3: 'totalMoney', 5: 'totalNumber', 6: 'totalNumber' }, {
      4: { f: `IF(B${dl + 1}=0,0,D${dl + 1}/B${dl + 1})`, s: 'totalPercent' },
    })
  );

  // ---------- 3. Рейси ----------
  const managerName = (id) => members.find((m) => m.id === id)?.name ?? '';
  const T = [
    head([
      'Рейс', 'Завантаження', 'Розвантаження', 'Звідки', 'Куди', 'Клієнт', 'ЄДРПОУ', 'Водій', 'Авто', 'Менеджер', 'Статус',
      'Км', 'Дохід, грн', 'Пальне, грн', 'ЗП водія, грн', 'Ремонт і ТО, грн', 'Дороги, грн', 'Інше, грн',
      'Витрати, грн', 'Прибуток, грн', 'Рентабельність', 'Оплата', 'Термін оплати', 'Дата оплати',
    ]),
  ];
  for (const { trip, cost } of rows) {
    const r = T.length + 1;
    const p = paymentStatus(trip);
    T.push([
      trip.number,
      { date: trip.loadDate },
      trip.unloadDate ? { date: trip.unloadDate } : null,
      trip.from.city,
      trip.to.city,
      trip.client?.name ?? '',
      clients.find((c) => c.id === trip.clientId)?.edrpou ?? '',
      driverOf(trip)?.name ?? '',
      vehicleOf(trip)?.plate ?? '',
      managerName(trip.managerId),
      t(TRIP_STATUS[trip.status]),
      { v: trip.distanceKm, s: 'number' },
      { v: trip.price, s: 'money' },
      { v: cost.fuel, s: 'money' },
      { v: cost.salary, s: 'money' },
      { v: cost.repair, s: 'money' },
      { v: cost.tolls, s: 'money' },
      { v: cost.other, s: 'money' },
      { f: `SUM(N${r}:R${r})`, s: 'money' },
      { f: `M${r}-S${r}`, s: 'money' },
      { f: `IF(M${r}=0,0,T${r}/M${r})`, s: 'percent' },
      p ? t(PAYMENT_STATUS[p]) : '',
      trip.payment?.dueDate ? { date: trip.payment.dueDate } : null,
      trip.payment?.paidAt ? { date: trip.payment.paidAt } : null,
    ]);
  }
  const tl = T.length;
  const money = Object.fromEntries([12, 13, 14, 15, 16, 17, 18, 19].map((c) => [c, 'totalMoney']));
  T.push(totalRow(24, 2, tl, { 11: 'totalNumber', ...money }, { 20: { f: `IF(M${tl + 1}=0,0,T${tl + 1}/M${tl + 1})`, s: 'totalPercent' } }));

  // ---------- 4. Клієнти ----------
  const group = (keyOf) => {
    const map = new Map();
    for (const r of rows) {
      const key = keyOf(r.trip);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()];
  };
  const C = [head(['Клієнт', 'ЄДРПОУ', 'Рейсів', 'Дохід, грн', 'Витрати, грн', 'Прибуток, грн', 'Рентабельність', 'Не оплачено, грн', 'З них прострочено, грн'])];
  group((tr) => tr.clientId ?? `name:${tr.client?.name ?? ''}`)
    .map(([key, list]) => ({ key, list, s: sum(list) }))
    .sort((a, b) => b.s.income - a.s.income)
    .forEach(({ key, list, s }) => {
      const r = C.length + 1;
      const client = clients.find((c) => c.id === key);
      const unpaid = list.filter((x) => ['pending', 'overdue'].includes(paymentStatus(x.trip)));
      C.push([
        client?.name ?? list[0].trip.client?.name ?? t('Без клієнта'),
        client?.edrpou ?? '',
        { v: s.trips, s: 'number' },
        { v: s.income, s: 'money' },
        { v: s.expenses, s: 'money' },
        { f: `D${r}-E${r}`, s: 'money' },
        { f: `IF(D${r}=0,0,F${r}/D${r})`, s: 'percent' },
        { v: unpaid.reduce((a, x) => a + x.trip.price, 0), s: 'money' },
        { v: unpaid.filter((x) => paymentStatus(x.trip) === 'overdue').reduce((a, x) => a + x.trip.price, 0), s: 'money' },
      ]);
    });
  const cl = C.length;
  C.push(
    totalRow(9, 2, cl, { 2: 'totalNumber', 3: 'totalMoney', 4: 'totalMoney', 5: 'totalMoney', 7: 'totalMoney', 8: 'totalMoney' }, {
      6: { f: `IF(D${cl + 1}=0,0,F${cl + 1}/D${cl + 1})`, s: 'totalPercent' },
    })
  );

  // ---------- 5. Водії ----------
  const W = [head(['Водій', 'Рейсів', 'Км', 'Дохід, грн', 'ЗП водія, грн', 'Прибуток, грн'])];
  group((tr) => tr.driverId ?? '')
    .map(([id, list]) => ({ id, list, s: sum(list) }))
    .sort((a, b) => b.s.income - a.s.income)
    .forEach(({ id, list, s }) => {
      W.push([
        drivers.find((d) => d.id === id)?.name ?? t('Без водія'),
        { v: s.trips, s: 'number' },
        { v: s.km, s: 'number' },
        { v: s.income, s: 'money' },
        { v: list.reduce((a, x) => a + x.cost.salary, 0), s: 'money' },
        { v: s.income - s.expenses, s: 'money' },
      ]);
    });
  W.push(totalRow(6, 2, W.length, { 1: 'totalNumber', 2: 'totalNumber', 3: 'totalMoney', 4: 'totalMoney', 5: 'totalMoney' }));

  // ---------- 6. Машини ----------
  const V = [head(['Авто', 'Модель', 'Рейсів', 'Км', 'Пальне, л', 'Пальне, грн', 'Дохід, грн', 'Витрати, грн', 'Прибуток, грн'])];
  group((tr) => tr.vehicleId ?? '')
    .map(([id, list]) => ({ id, list, s: sum(list) }))
    .sort((a, b) => b.s.income - a.s.income)
    .forEach(({ id, list, s }) => {
      const v = vehicles.find((x) => x.id === id);
      const r = V.length + 1;
      V.push([
        v?.plate ?? t('Без машини'),
        v?.model ?? '',
        { v: s.trips, s: 'number' },
        { v: s.km, s: 'number' },
        { v: Math.round(list.reduce((a, x) => a + x.cost.fuelLiters, 0)), s: 'number' },
        { v: list.reduce((a, x) => a + x.cost.fuel, 0), s: 'money' },
        { v: s.income, s: 'money' },
        { v: s.expenses, s: 'money' },
        { f: `G${r}-H${r}`, s: 'money' },
      ]);
    });
  V.push(totalRow(9, 2, V.length, { 2: 'totalNumber', 3: 'totalNumber', 4: 'totalNumber', 5: 'totalMoney', 6: 'totalMoney', 7: 'totalMoney', 8: 'totalMoney' }));

  const blob = buildXlsx(
    [
      { name: t('Зведення'), rows: S, cols: [44, 18, 20, 12] },
      { name: t('Динаміка'), rows: D, cols: [26, 14, 14, 14, 15, 9, 12], freeze: 'A2' },
      {
        name: t('Рейси'),
        rows: T,
        cols: [10, 13, 13, 14, 14, 26, 12, 20, 13, 24, 12, 8, 12, 12, 12, 12, 11, 10, 12, 12, 13, 15, 13, 13],
        freeze: 'B2',
        autoFilter: `A1:X${Math.max(tl, 1)}`,
      },
      { name: t('Клієнти'), rows: C, cols: [30, 12, 9, 14, 14, 14, 15, 17, 20], freeze: 'A2' },
      { name: t('Водії'), rows: W, cols: [26, 9, 10, 14, 15, 14], freeze: 'A2' },
      { name: t('Машини'), rows: V, cols: [14, 26, 9, 10, 11, 13, 14, 14, 14], freeze: 'A2' },
    ],
    { title: t('Фінансовий звіт · {company}', { company: company.name }), author: me || 'NeVpade' }
  );
  downloadBlob(blob, `zvit-${from}_${to}.xlsx`);
  return { trips: rows.length, income: cur.income };
}

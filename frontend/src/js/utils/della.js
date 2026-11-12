// Імпорт вантажу з біржі Della (della.ua).
// Менеджер виділяє оголошення на Della і натискає кнопку «→ NeVpade» в закладках браузера
// (або копіює текст і вставляє у форму). Тут цей текст розбирається на поля рейсу.
// Формат оголошень Della може змінюватись, тому розбір «м'який»: що не впізнали — лишаємо
// порожнім, менеджер допише вручну у формі.

const L = 'а-яіїєґё'; // малі кириличні літери
const NOT_LETTER = `(?![${L}a-z])`;
const SP = '[\\s\\u00a0\\u202f]'; // пробіли, зокрема нерозривні (ними Della ділить тисячі)

const num = (s) => Number(String(s).replace(/[\s  ]/g, '').replace(',', '.'));

const BODY_TYPES = [
  ['рефрижератор', /рефриж|реф\b/i],
  ['ізотерм', /ізотерм|изотерм/i],
  ['тент', /тент/i],
  ['цільнометалевий', /цільномет|цельномет/i],
  ['крита', /крит[аі]|кры?т/i],
  ['бортова', /борт/i],
  ['контейнеровоз', /контейнер/i],
  ['зерновоз', /зерновоз/i],
  ['самоскид', /самоскид|самосвал/i],
  ['автовоз', /автовоз/i],
  ['платформа', /платформ|площадк/i],
  ['трал', /трал\b/i],
  ['цистерна', /цистерн/i],
  ['бус', /\bбус\b|мікроавтобус|микроавтобус/i],
];

const LOADING = [
  ['верхнє', /верхн|зверху|сверху/i],
  ['бокове', /боков|збоку|сбоку/i],
  ['заднє', /задн|ззаду|сзади/i],
  ['повна розтентовка', /розтент|растент/i],
];

const CARGO_WORDS =
  /(тнп|зерно|пшениц\w*|кукурудз\w*|кукуруз\w*|соняшник\w*|подсолнечн\w*|ячмін\w*|ячмен\w*|соя|ріпак|рапс|борошно|мука|цукор|сахар|добрив\w*|удобрен\w*|будматеріал\w*|стройматериал\w*|цемент|пісок|песок|щебінь|щебень|метал\w*|металопрокат|труби|трубы|ліс\w*|лес\w*|пиломатеріал\w*|пиломатериал\w*|дошк\w*|дерево|меблі|мебель|техніка|техника|обладнання|оборудование|продукт\w*|напої|напитки|овочі|овощи|фрукти|фрукты|м'ясо|мясо|молочн\w*|палет\w*|піддон\w*|поддон\w*|текстиль|одяг|одежда|побутов\w* техн\w*|хімі\w*|хими\w*|пластик\w*|папір|бумага|картон|скло|стекло|шини|шины|запчастин\w*|корм\w*|упаковк\w*|генеральн\w* вантаж|сборн\w* груз|збірн\w* вантаж)/i;

// Рядки інтерфейсу Della, які точно не є назвою міста
const UI_WORDS =
  /^(докладніше|подробнее|детальніше|контакти|контакты|телефон|показати|показать|завантаження|загрузка|розвантаження|разгрузка|прямий|прямой|вантажовласник|грузовладелец|оплата|ставка|ціна|цена|кузов|вантаж|груз|відстань|расстояние|дата|звідки|откуда|куди|куда|маршрут|примітк|примечан|постійно|постоянно|щодня|ежедневно|сьогодні|сегодня|завтра|готівка|наличные|безгот|безнал|пдв|ндс|до\s|з\s|с\s)/i;

const REGION = new RegExp(`^(.*?)[,\\s]*((?:[А-ЯІЇЄҐ][${L}'’]+(?:ська|цька|зька|ская|цкая|зкая)\\s+(?:обл\\.?|область|р-н|район))|(?:АР\\s?Крим))\\s*$`);

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// «11.11», «11.11.26», «11.11.2026», «сьогодні», «завтра»; рік без явного зазначення — найближчий у майбутньому
function parseDates(text, today = new Date()) {
  const out = [];
  // після числа не має йти одиниця виміру — інакше «22.06 грн/км» чи «3.5 т» стали б датами
  const re = new RegExp(`(?<![\\d.,])(\\d{1,2})\\.(\\d{1,2})(?:\\.(\\d{2,4}))?(?![\\d.,])(?!${SP}*(?:грн|uah|₴|т|км|м|куб|\\$|€|%))`, 'gi');
  for (const m of text.matchAll(re)) {
    const day = +m[1];
    const month = +m[2];
    if (day < 1 || day > 31 || month < 1 || month > 12) continue;
    let year = m[3] ? +m[3] : today.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(year, month - 1, day);
    if (!m[3] && d < new Date(today.getFullYear(), today.getMonth(), today.getDate() - 60)) d.setFullYear(year + 1);
    out.push(iso(d));
  }
  if (!out.length) {
    if (/сьогодні|сегодня/i.test(text)) out.push(iso(today));
    else if (/завтра/i.test(text)) out.push(iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)));
  }
  return out;
}

// «Ковель, Волинська обл.» → { city: 'Ковель', region: 'Волинська обл.' }
function splitPlace(raw) {
  const s = raw.replace(/\s+/g, ' ').replace(/[,;\s]+$/, '').trim();
  const m = s.match(REGION);
  if (m && m[1].trim()) return { city: m[1].trim().replace(/,$/, ''), region: m[2].trim() };
  const [city, ...rest] = s.split(/,\s*/);
  return { city: city.trim(), region: rest.join(', ') };
}

const looksLikePlace = (line) =>
  line.length >= 2 &&
  line.length <= 60 &&
  /^[А-ЯІЇЄҐA-Z]/.test(line) &&
  !/\d/.test(line) &&
  !UI_WORDS.test(line) &&
  !BODY_TYPES.some(([, re]) => re.test(line)) &&
  !/^(ТОВ|ПП|ФОП|ПрАТ|АТ|ТзОВ|ООО|ЧП|ПАО|ПАТ)\b/.test(line);

const LABEL_FROM = /^(?:звідки|откуда|завантаження|загрузка|місце завантаження|место загрузки)\s*[:—-]\s*(.+)$/i;
const LABEL_TO = /^(?:куди|куда|розвантаження|разгрузка|місце розвантаження|место разгрузки)\s*[:—-]\s*(.+)$/i;

function parseRoute(text) {
  // 0) Підписані рядки: «Звідки: Корюківка, Чернігівська обл.» / «Куди: …»
  const lines0 = text.split('\n').map((l) => l.trim());
  const labeled = (re) => lines0.map((l) => l.match(re)?.[1]).find((v) => v && !/^\d/.test(v));
  const lf = labeled(LABEL_FROM);
  const lt = labeled(LABEL_TO);
  if (lf && lt) return [splitPlace(lf), splitPlace(lt)];
  // 1) Явна стрілка або тире з пробілами: «Біла Церква → Русанів», «Київ - Львів»
  for (const line of text.split('\n')) {
    const parts = line.split(/\s*(?:→|⟶|->|—>|\s[-–—]\s)\s*/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const clean = (p) => p.replace(/^\d{1,2}\.\d{1,2}(?:\.\d{2,4})?\s*/, '').replace(/\s+\d[\d\s]*км.*$/i, '').trim();
      const from = clean(parts[0]);
      const to = clean(parts[parts.length - 1]);
      if (looksLikePlace(splitPlace(from).city) && looksLikePlace(splitPlace(to).city)) return [splitPlace(from), splitPlace(to)];
    }
  }
  // 2) Міста окремими рядками (картка оголошення): перші два «схожі на місто» рядки,
  //    рядок з областю одразу після міста — це його область
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const places = [];
  let prevWasPlace = false;
  for (const line of lines) {
    const region = line.match(REGION);
    if (region && !region[1].trim()) {
      if (prevWasPlace) places[places.length - 1].region ||= region[2].trim();
      prevWasPlace = false;
      continue;
    }
    if (places.length === 2) break;
    prevWasPlace = looksLikePlace(line);
    if (prevWasPlace) places.push(splitPlace(line));
  }
  return places.length === 2 ? places : [places[0] ?? { city: '', region: '' }, { city: '', region: '' }];
}

function parsePhone(text) {
  const m = text.match(/(?:\+?38)?[\s(]*0\d{2}[\s)-]*\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/);
  if (!m) return '';
  const digits = m[0].replace(/\D/g, '').replace(/^38/, '');
  return digits.length === 10 ? `+38${digits}` : '';
}

/**
 * Розбирає текст оголошення Della.
 * @returns {{ from, to, loadDate, unloadDate, cargoType, weightT, volumeM3, distanceKm, price, currency,
 *            ratePerKm, bodyType, loadingType, payment, clientName, clientPhone, url, found: string[] }}
 */
export function parseDellaListing(rawText, { today = new Date() } = {}) {
  const text = String(rawText ?? '')
    .replace(/\r/g, '')
    .replace(/[  ]/g, ' ')
    .slice(0, 6000);
  const one = text.replace(/\n+/g, ' ');
  const found = [];
  const pick = (re, i = 1) => one.match(re)?.[i];

  const [from, to] = parseRoute(text);
  if (from.city && to.city) found.push('route');

  const dates = parseDates(one, today);
  const loadDate = dates[0] ?? '';
  const unloadDate = dates[1] && dates[1] >= dates[0] ? dates[1] : '';
  if (loadDate) found.push('date');

  const weight = pick(new RegExp(`(?<![\\d.,])(\\d+(?:[.,]\\d+)?)${SP}*(?:т|тонн?[аи]?|t)${NOT_LETTER}`, 'i'));
  const volume = pick(new RegExp(`(?<![\\d.,])(\\d+(?:[.,]\\d+)?)${SP}*(?:м³|м3|куб\\.?\\s?м|м\\.?\\s?куб)`, 'i'));
  const distance = pick(new RegExp(`(?<![\\d.,])(\\d{1,3}(?:${SP}\\d{3})*|\\d+)${SP}*км${NOT_LETTER}(?!\\s*\\/)`, 'i'));
  const rate = pick(new RegExp(`(\\d+(?:[.,]\\d+)?)${SP}*(?:грн|uah|₴)${SP}*\\/${SP}*км`, 'i'));
  const priceMatch = one.match(
    new RegExp(`(?<![\\d.,])(\\d{1,3}(?:${SP}\\d{3})+|\\d+)(?:[.,]\\d+)?${SP}*(грн|uah|₴|\\$|usd|€|eur)(?!${SP}*\\/)`, 'i')
  );
  if (weight) found.push('weight');
  if (distance) found.push('distance');
  if (priceMatch) found.push('price');

  const cargoLabel = text.match(/(?:^|\n)\s*(?:вантаж|груз|найменування(?: вантажу)?)\s*[:—-]\s*([^;\n]{2,40})/i)?.[1];
  const cargoWord = one.match(CARGO_WORDS)?.[0];
  const cargoType = (cargoLabel || cargoWord || '').trim().replace(/^./, (c) => c.toUpperCase());
  if (cargoType) found.push('cargo');

  const bodyType = BODY_TYPES.find(([, re]) => re.test(one))?.[0] ?? '';
  const loadingType = LOADING.filter(([, re]) => re.test(one.replace(/завантаж\w*|загруз\w*/gi, ''))).map(([n]) => n).join(', ');
  const payment = [
    /безгот|безнал|б\/г|б\/н/i.test(one) && 'безготівка',
    /готівк|наличн|нал\b/i.test(one) && !/безгот|безнал/i.test(one) && 'готівка',
    /на\s?карт/i.test(one) && 'на картку',
    /з\s?пдв|с\s?ндс|пдв|ндс/i.test(one) && (/без\s?пдв|без\s?ндс/i.test(one) ? 'без ПДВ' : 'з ПДВ'),
  ]
    .filter(Boolean)
    .join(', ');

  const company =
    text.match(/(?:ТОВ|ТзОВ|ПП|ФОП|ПрАТ|ПАТ|АТ|ООО|ЧП)\s*(?:[«"“][^»"”\n]{2,40}[»"”]|[^,;\n\d+(]{2,40})/)?.[0]?.trim() ?? '';
  const url = one.match(/https?:\/\/(?:www\.)?della\.(?:ua|com\.ua|net)[^\s"'<>]*/i)?.[0] ?? '';

  const currencyRaw = priceMatch?.[2]?.toLowerCase();
  const currency = { $: 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR' }[currencyRaw] ?? 'UAH';

  return {
    from,
    to,
    loadDate,
    unloadDate,
    cargoType,
    weightT: weight ? num(weight) : null,
    volumeM3: volume ? num(volume) : null,
    distanceKm: distance ? Math.round(num(distance)) : null,
    price: priceMatch ? Math.round(num(priceMatch[1])) : null,
    currency,
    ratePerKm: rate ? num(rate) : null,
    bodyType,
    loadingType,
    payment,
    clientName: company,
    clientPhone: parsePhone(one),
    url,
    found,
  };
}

/**
 * Код закладки для браузера: на сторінці Della бере виділений текст (або весь текст сторінки
 * оголошення) і відкриває форму нового рейсу в NeVpade з цими даними.
 * Дані передаються в #-частині адреси — вони не йдуть ні на сервер Della, ні на наш сервер.
 */
export function dellaBookmarklet(origin = location.origin) {
  const target = `${origin}/pages/trips.html#della=`;
  const code = `(function(){var s=String(getSelection()).trim();if(!s){var m=document.querySelector('main')||document.body;s=m.innerText;}s=s.slice(0,4000);window.open(${JSON.stringify(target)}+encodeURIComponent(s+'\\n'+location.href),'_blank');})();`;
  return `javascript:${encodeURIComponent(code)}`;
}

// ============================================================
// Парсинг сторінки пошуку Della (HTML) — список вантажів
// Структура картки (листопад 2026):
//   .request_card[.deleted — закрито]
//     .date_add «16.11–17.11» · .truck_type «тент» · .weight «0,16 т» · .cube «5 м³»
//     .request_route: span[title="Мукачівський р-н, Закарпатська обл."] > .locality «Мукачево» — … · .distance «802 км»
//     .cargo_type «тнв в коробках» · .request_tags .tag «Збоку», «Зверху»
//     .price_main «5 000 грн» · .price_additional «6,23 грн/км» · .price_tags .tag «ПДВ», «Безготівковий»
// Якщо Della змінить верстку — оновлюємо селектори тут.
// ============================================================

const textOf = (root, selector) => root.querySelector(selector)?.textContent.replace(/\s+/g, ' ').trim() ?? '';
const tagsOf = (root, selector) => [...root.querySelectorAll(selector)].map((t) => t.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);

// Абревіатури Della пишемо великими: «тнв на палетах» → «ТНВ на палетах»
const ABBR = new RegExp(`^(тнв|тнп|тнс|пмм|жбв)(?![${L}])`, 'i'); // \b не працює з кирилицею
const cargoName = (s) => (ABBR.test(s) ? s.replace(ABBR, (m) => m.toUpperCase()) : s.replace(/^./, (c) => c.toUpperCase()));

// «Мукачівський р-н, Закарпатська обл.» → «Закарпатська обл.»; «Київ обл.» → «Київська обл.» не вигадуємо, лишаємо як є
const regionOf = (title = '') => title.split(',').map((s) => s.trim()).filter(Boolean).pop() ?? '';

const LOADING_TAGS = { збоку: 'бокове', зверху: 'верхнє', задня: 'заднє', ззаду: 'заднє', 'повна розтентовка': 'повна розтентовка' };

function parseCard(card, today) {
  // Пункти йдуть підряд; текст «—» відділяє завантаження від розвантаження
  const loading = [];
  const unloading = [];
  let afterDash = false;
  for (const node of card.querySelector('.request_route .request_distance')?.childNodes ?? []) {
    if (node.nodeType === Node.TEXT_NODE && node.textContent.includes('—')) afterDash = true;
    if (node.nodeType !== Node.ELEMENT_NODE || !node.matches('span[title]')) continue;
    (afterDash ? unloading : loading).push({ city: textOf(node, '.locality'), region: regionOf(node.getAttribute('title')) });
  }
  const places = [...loading, ...unloading];
  const from = loading[0] ?? places[0] ?? { city: '', region: '' };
  const to = unloading[unloading.length - 1] ?? places[places.length - 1] ?? { city: '', region: '' };
  const stops = [...loading.slice(1), ...unloading.slice(0, -1)].map((p) => p.city);

  const [loadDate = '', unloadDate = ''] = parseDates(textOf(card, '.date_add'), today);

  const priceBlock = card.querySelector('.price_main')?.cloneNode(true);
  priceBlock?.querySelectorAll('.price_diff_arrow_block').forEach((el) => el.remove()); // «вартість збільшена на 300 грн» — не ціна
  const priceText = priceBlock?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  const priceMatch = priceText.match(/([\d\s]+)(?:[.,]\d+)?\s*(грн|uah|\$|usd|€|eur)/i);
  const currency = { $: 'USD', usd: 'USD', '€': 'EUR', eur: 'EUR' }[priceMatch?.[2]?.toLowerCase()] ?? 'UAH';

  const cube = textOf(card, '.cube').match(/[\d.,]+/g); // «90-96 м³» → беремо більше значення
  const tags = tagsOf(card, '.request_tags .tag');
  const priceTags = tagsOf(card, '.price_tags .tag');
  const rate = textOf(card, '.price_additional').match(/([\d.,]+)\s*грн\/км/i);

  return {
    from,
    to,
    stops,
    loadDate,
    unloadDate: unloadDate && unloadDate >= loadDate ? unloadDate : '',
    cargoType: cargoName(textOf(card, '.cargo_type')),
    weightT: num(textOf(card, '.weight').match(/[\d.,]+/)?.[0] ?? NaN) || null,
    volumeM3: cube ? num(cube[cube.length - 1]) : null,
    distanceKm: Math.round(num(textOf(card, '.request_route .distance').match(/[\d\s]+/)?.[0] ?? NaN)) || null,
    price: priceMatch ? Math.round(num(priceMatch[1])) : null,
    currency,
    ratePerKm: rate ? num(rate[1]) : null,
    bodyType: textOf(card, '.truck_type'),
    loadingType: tags.map((t) => LOADING_TAGS[t.toLowerCase()]).filter(Boolean).join(', '),
    payment: priceTags.map((t) => (/^пдв$/i.test(t) ? 'ПДВ' : t.toLowerCase())).join(', '),
    extra: tags.filter((t) => !LOADING_TAGS[t.toLowerCase()]),
    closed: card.classList.contains('deleted'),
    isNew: Boolean(card.querySelector('.relevance_request_block .new')),
    posted: textOf(card, '.time_string'),
    directShipper: Boolean(card.querySelector('.zirka_block')),
    clientName: '',
    clientPhone: '',
    url: '',
    found: ['route', 'date', 'cargo', 'weight', 'distance', ...(priceMatch ? ['price'] : [])],
  };
}

/**
 * Розбирає HTML сторінки пошуку Della.
 * @returns {{ listings: object[], nextPageUrl: string, total: number|null }}
 */
export function parseDellaSearchPage(html, { pageUrl = 'https://della.ua/', today = new Date() } = {}) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const listings = [...doc.querySelectorAll('.request_card')].map((card) => ({ ...parseCard(card, today), url: pageUrl }));

  // Наступна сторінка: посилання «перейти до стор. N+1»
  const current = Number(doc.querySelector('td.page:not(:has(a))')?.textContent.trim()) || 1;
  const next = doc.querySelector(`a.pages[title$="стор. ${current + 1}"]`);
  const nextPageUrl = next ? new URL(next.getAttribute('href'), pageUrl).href : '';
  const total = Number(doc.body.textContent.match(/Знайдено\s+([\d\s ]+)/)?.[1].replace(/\D/g, '')) || null;

  return { listings, nextPageUrl, total };
}

/** Чи є вже такий вантаж серед рейсів (маршрут, дата завантаження, вага) */
export const sameCargo = (trip, d) =>
  trip.from.city.toLowerCase() === d.from.city.toLowerCase() &&
  trip.to.city.toLowerCase() === d.to.city.toLowerCase() &&
  trip.loadDate === d.loadDate &&
  Number(trip.cargo.weightT) === Number(d.weightT);

/** Примітка до рейсу з даних Della — українською, як на сайті */
export function dellaNotes(d) {
  const fmt = (n) => Number(n).toLocaleString('uk-UA');
  return [
    d.bodyType && `Кузов: ${d.bodyType}`,
    d.loadingType && `завантаження: ${d.loadingType}`,
    d.stops?.length && `через: ${d.stops.join(', ')}`,
    d.extra?.length && d.extra.join(', '),
    d.payment && `оплата: ${d.payment}`,
    d.ratePerKm && `${fmt(d.ratePerKm)} грн/км`,
    d.currency !== 'UAH' && d.price && `ставка на Della: ${fmt(d.price)} ${d.currency}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Дані для POST /trips з вантажу Della (ціна має бути в гривнях) */
export const dellaToTrip = (d) => ({
  from: { city: d.from.city, address: d.from.region },
  to: { city: d.to.city, address: d.to.region },
  loadDate: d.loadDate,
  unloadDate: d.unloadDate || null,
  cargo: { type: d.cargoType || 'Вантаж з Della', weightT: d.weightT, volumeM3: d.volumeM3 },
  distanceKm: d.distanceKm,
  price: d.price,
  client: { name: d.clientName || '', phone: d.clientPhone || '' },
  driverId: null,
  vehicleId: null,
  notes: dellaNotes(d),
  source: 'import',
  importedFrom: { platform: 'della', url: d.url || null },
});

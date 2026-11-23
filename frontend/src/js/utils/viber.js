// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('uk-UA') : '');

// Текст повідомлення замовнику (кнопка з літачком у списку рейсів, «Надіслати замовнику» й «Копіювати» в картці рейсу):
// коли й що везуть, яка машина й водій приїдуть, скільки й до коли сплатити
const CLIENT_TEMPLATE = [
  '📦 Рейс №{ID}: {ROUTE}',
  '📅 Завантаження: {DATE}',
  '🏁 Розвантаження: {UNLOAD}',
  '📦 Вантаж: {CARGO}, {WEIGHT}',
  '🚛 Авто: {VEHICLE}',
  '👤 Водій: {DRIVER}',
  '💰 Вартість: {PRICE}',
  '🗓 Оплата до: {DUE}',
].join('\n');

// Значення змінних для конкретного рейсу
function tripVariables(trip, driver, vehicle) {
  return {
    ID: trip.number,
    ROUTE: `${trip.from.city} → ${trip.to.city}`,
    DATE: date(trip.loadDate),
    ADDRESS: [trip.from.city, trip.from.address].filter(Boolean).join(', '),
    CARGO: trip.cargo.type,
    WEIGHT: `${trip.cargo.weightT} т`,
    DRIVER: driver ? `${driver.name}, ${driver.phone}` : '—',
    VEHICLE: vehicle ? `${vehicle.plate} (${vehicle.model})` : '—',
    CLIENT: trip.client?.name || '—',
    PHONE: trip.client?.phone || '—',
    UNLOAD: [date(trip.unloadDate), trip.to.city, trip.to.address].filter(Boolean).join(', '),
    PRICE: trip.price ? `${Number(trip.price).toLocaleString('uk-UA')} грн` : '—',
    DUE: date(trip.payment?.dueDate) || '—',
  };
}

// Підставляє значення; невідомі змінні лишає як є, щоб помилку було видно
const fillTemplate = (template, vars) =>
  template.replace(/\{([A-Z_]+)\}/g, (match, key) => (key in vars ? vars[key] : match));

export const buildClientMessage = (trip, driver, vehicle) =>
  fillTemplate(CLIENT_TEMPLATE, tripVariables(trip, driver, vehicle));

export function sendToViber(text) {
  // Відкриває Viber з вибором контакту для пересилання
  window.location.href = `viber://forward?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

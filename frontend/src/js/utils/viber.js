// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)

// Текст повідомлення водію (кнопка «Viber» на сторінках рейсів і карти)
const VIBER_TEMPLATE = [
  '🚚 Рейс №{ID}: {ROUTE}',
  '📅 Завантаження: {DATE}',
  '📍 Адреса: {ADDRESS}',
  '📦 {CARGO}, {WEIGHT}',
  '🚛 Авто: {VEHICLE}',
  '🏢 Клієнт: {CLIENT}, {PHONE}',
].join('\n');

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('uk-UA') : '');

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
  };
}

// Підставляє значення; невідомі змінні лишає як є, щоб помилку було видно
const fillTemplate = (template, vars) =>
  template.replace(/\{([A-Z_]+)\}/g, (match, key) => (key in vars ? vars[key] : match));

export const buildTripMessage = (trip, driver, vehicle) =>
  fillTemplate(VIBER_TEMPLATE, tripVariables(trip, driver, vehicle));

export function sendToViber(text) {
  // Відкриває Viber з вибором контакту для пересилання
  window.location.href = `viber://forward?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

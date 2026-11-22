// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)
import { clientMessage } from '../api/trips.js';
import { showToast } from './toast.js';

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

/**
 * Замовнику рейсу у Viber. Бекенд готує повідомлення (хто пише, вантаж, водій, авто, посилання на документи
 * водія й машини) і посилання viber://chat?number=<номер замовника>&draft=<текст>: Viber відкривається одразу
 * в чаті з замовником, текст уже набрано — лишається натиснути «Надіслати».
 * Текст ще й копіюється: якщо Viber для ПК не підставить його в чат, його можна вставити.
 * fallbackText — для режиму моків (сервера немає): Viber з вибором контакту, як раніше.
 */
export async function sendToClient(tripId, fallbackText = '') {
  let msg;
  try {
    msg = await clientMessage(tripId);
  } catch (err) {
    showToast(err.message, 'error'); // напр. «Спершу призначте на рейс водія й машину»
    return;
  }
  if (!msg) return sendToViber(fallbackText);
  await copyText(msg.text).catch(() => {});
  msg.warnings.forEach((w) => showToast(w, 'info', 6000)); // немає номера замовника, прострочені документи…
  window.location.href = msg.viberUrl ?? msg.forwardUrl;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

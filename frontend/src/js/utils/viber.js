// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)
import { clientMessage } from '../api/trips.js';
import { showToast } from './toast.js';
<<<<<<< HEAD
import { confirmDialog } from './confirm.js';
=======
>>>>>>> 5e65465c934406626eb48aa3032b52eb680af3aa

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

<<<<<<< HEAD
// Телефон: лише там у меню «Поділитися» є Viber (на ПК системне меню Windows/macOS Viber зазвичай не показує)
const isPhone = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Фото й PDF документів (паспорт і права водія, техпаспорт і страховка машини) як файли для «Поділитися»
async function documentFiles(documents) {
  const files = await Promise.all(
    documents.map(async (d) => {
      try {
        const res = await fetch(d.url);
        if (!res.ok) return null;
        const ext = d.name.includes('.') ? d.name.slice(d.name.lastIndexOf('.')) : d.mime === 'application/pdf' ? '.pdf' : '.jpg';
        return new File([await res.blob()], `${d.label}${ext}`, { type: d.mime });
      } catch {
        return null;
      }
    })
  );
  return files.filter(Boolean);
}

// Меню «Поділитися» з фото й текстом. true — надіслано або користувач сам закрив меню
async function shareFiles(files, text) {
  try {
    await navigator.share({ files, text });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') return true; // закрили меню — нічого не робимо
    if (err.name !== 'NotAllowedError') return false;
    // Фото вантажились довго, і браузер «забув» натискання — просимо натиснути ще раз
    const ok = await confirmDialog({ title: 'Фото документів готові', text: 'Надіслати їх замовнику у Viber?', confirmText: 'Надіслати' });
    if (!ok) return true;
    return navigator.share({ files, text }).then(() => true, (e) => e.name === 'AbortError');
  }
}

/**
 * Замовнику рейсу у Viber. Бекенд готує повідомлення (хто пише, вантаж, водій, авто, посилання на документи)
 * і список документів: паспорт і права водія, техпаспорт і страховка машини.
 * - Телефон: меню «Поділитися» з фото документів і текстом → Viber → контакт замовника → фото й текст приходять разом.
 * - Комп'ютер (або телефон без «Поділитися» з файлами): viber://chat?number=<номер замовника>&draft=<текст> —
 *   Viber відкривається одразу в чаті з замовником, текст набрано; фото — за посиланням у тексті (з прев'ю).
 * Текст ще й копіюється: якщо Viber не підставить його в чат, його можна вставити.
=======
/**
 * Замовнику рейсу у Viber. Бекенд готує повідомлення (хто пише, вантаж, водій, авто, посилання на документи
 * водія й машини) і посилання viber://chat?number=<номер замовника>&draft=<текст>: Viber відкривається одразу
 * в чаті з замовником, текст уже набрано — лишається натиснути «Надіслати».
 * Текст ще й копіюється: якщо Viber для ПК не підставить його в чат, його можна вставити.
>>>>>>> 5e65465c934406626eb48aa3032b52eb680af3aa
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
<<<<<<< HEAD

  if (isPhone() && msg.documents.length && navigator.canShare) {
    const files = await documentFiles(msg.documents);
    if (files.length && navigator.canShare({ files, text: msg.text })) {
      if (msg.phone) showToast(`У Viber оберіть замовника: ${msg.phone}`, 'info', 8000);
      if (await shareFiles(files, msg.text)) return;
    }
  }
=======
>>>>>>> 5e65465c934406626eb48aa3032b52eb680af3aa
  window.location.href = msg.viberUrl ?? msg.forwardUrl;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)
import { load } from './storage.js';

// Змінні, які можна вставляти в шаблон
export const PLACEHOLDERS = [
  { key: 'ID', label: 'Номер рейсу' },
  { key: 'ROUTE', label: 'Маршрут' },
  { key: 'DATE', label: 'Дата завантаження' },
  { key: 'ADDRESS', label: 'Адреса завантаження' },
  { key: 'CARGO', label: 'Вантаж' },
  { key: 'WEIGHT', label: 'Вага' },
  { key: 'DRIVER', label: 'Водій' },
  { key: 'VEHICLE', label: 'Авто' },
  { key: 'CLIENT', label: 'Клієнт' },
  { key: 'PHONE', label: 'Телефон клієнта' },
];

export const DEFAULT_VIBER_TEMPLATE = [
  '🚚 Рейс №{ID}: {ROUTE}',
  '📅 Завантаження: {DATE}',
  '📍 Адреса: {ADDRESS}',
  '📦 {CARGO}, {WEIGHT}',
  '🚛 Авто: {VEHICLE}',
  '🏢 Клієнт: {CLIENT}, {PHONE}',
].join('\n');

const date = (iso) => (iso ? new Date(iso).toLocaleDateString('uk-UA') : '');

// Значення змінних для конкретного рейсу
export function tripVariables(trip, driver, vehicle) {
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
export const fillTemplate = (template, vars) =>
  template.replace(/\{([A-Z_]+)\}/g, (match, key) => (key in vars ? vars[key] : match));

// Змінні в шаблоні, яких немає в списку PLACEHOLDERS
export function unknownPlaceholders(template) {
  const known = new Set(PLACEHOLDERS.map((p) => p.key));
  return [...new Set([...template.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]))].filter((k) => !known.has(k));
}

// Шаблон, збережений у профілі (Сповіщення та Viber), або стандартний
export const getViberTemplate = () => load('settings')?.viberTemplate || DEFAULT_VIBER_TEMPLATE;

export const buildTripMessage = (trip, driver, vehicle) =>
  fillTemplate(getViberTemplate(), tripVariables(trip, driver, vehicle));

export function sendToViber(text) {
  // Відкриває Viber з вибором контакту для пересилання
  window.location.href = `viber://forward?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

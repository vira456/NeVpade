// Формування структурованого повідомлення для диспетчеризації у Viber (URI Scheme)
export function buildTripMessage(trip, driver, vehicle) {
  return [
    `🚚 Рейс ${trip.number}`,
    `📍 ${trip.from.city} → ${trip.to.city}`,
    `📅 Завантаження: ${trip.loadDate}`,
    `📦 ${trip.cargo.type}, ${trip.cargo.weightT} т`,
    driver ? `👤 Водій: ${driver.name}, ${driver.phone}` : null,
    vehicle ? `🚛 Авто: ${vehicle.plate} (${vehicle.model})` : null,
    `🏢 Клієнт: ${trip.client.name}, ${trip.client.phone}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function sendToViber(text) {
  // Відкриває Viber з вибором контакту для пересилання
  window.location.href = `viber://forward?text=${encodeURIComponent(text)}`;
}

export async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

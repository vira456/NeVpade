// Заявка на перевезення — друкована форма (або «Зберегти як PDF» у вікні друку браузера).
// Документ завжди українською: його підписують і передають клієнту/перевізнику.
import { escapeHtml } from './format.js';
import { getCurrentUser } from '../api/auth.js';

const date = (iso) => (iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('uk-UA') : '—');
const money = (n) => `${Number(n).toLocaleString('uk-UA')} грн`;

export function printTripRequest(trip, { driver, vehicle, client, manager } = {}) {
  const company = getCurrentUser()?.companyName || 'ТОВ «Західтранс»';
  const row = (label, value) => `<tr><th>${label}</th><td>${value || '—'}</td></tr>`;
  const html = `<!doctype html>
<html lang="uk"><head><meta charset="utf-8" />
<title>Заявка ${escapeHtml(trip.number)}</title>
<style>
  @page { size: A4; margin: 18mm; }
  body { font: 13px/1.5 'Segoe UI', Arial, sans-serif; color: #111; max-width: 820px; margin: 56px auto 32px; padding: 0 24px; }
  @media print { body { max-width: none; margin: 0; padding: 0; } }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 18px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #555; }
  h2 { font-size: 14px; margin: 22px 0 8px; text-transform: none; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border: 1px solid #bbb; }
  th { width: 34%; background: #f3f3f3; font-weight: 600; }
  .sign { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 46px; }
  .sign div { border-top: 1px solid #111; padding-top: 6px; }
  .print-btn { position: fixed; top: 12px; right: 12px; padding: 8px 14px; font: inherit; cursor: pointer; }
  @media print { .print-btn { display: none; } }
</style></head>
<body>
  <button class="print-btn" onclick="print()">Друкувати / зберегти PDF</button>
  <header>
    <div>
      <h1>Заявка на перевезення № ${escapeHtml(trip.number)}</h1>
      <div class="muted">від ${date(new Date().toISOString().slice(0, 10))}</div>
    </div>
    <div style="text-align:right"><strong>${escapeHtml(company)}</strong><div class="muted">Перевізник</div></div>
  </header>

  <h2>Замовник</h2>
  <table>
    ${row('Назва', escapeHtml(trip.client?.name ?? client?.name))}
    ${row('ЄДРПОУ', escapeHtml(client?.edrpou))}
    ${row('Контактна особа', escapeHtml(client?.contactName))}
    ${row('Телефон', escapeHtml(trip.client?.phone ?? client?.phone))}
  </table>

  <h2>Маршрут і вантаж</h2>
  <table>
    ${row('Місце завантаження', escapeHtml([trip.from.city, trip.from.address].filter(Boolean).join(', ')))}
    ${row('Дата завантаження', date(trip.loadDate))}
    ${row('Місце розвантаження', escapeHtml([trip.to.city, trip.to.address].filter(Boolean).join(', ')))}
    ${row('Дата розвантаження', date(trip.unloadDate))}
    ${row('Відстань', trip.distanceKm ? `${trip.distanceKm} км` : '')}
    ${row('Вантаж', escapeHtml(trip.cargo.type))}
    ${row('Вага / об\'єм', `${trip.cargo.weightT} т${trip.cargo.volumeM3 ? ` / ${trip.cargo.volumeM3} м³` : ''}`)}
    ${row('Примітки', escapeHtml(trip.notes))}
  </table>

  <h2>Транспорт</h2>
  <table>
    ${row('Автомобіль', vehicle ? escapeHtml(`${vehicle.plate}, ${vehicle.model}${vehicle.type ? ` (${vehicle.type})` : ''}`) : '')}
    ${row('Водій', driver ? escapeHtml(`${driver.name}, ${driver.phone}`) : '')}
  </table>

  <h2>Умови</h2>
  <table>
    ${row('Вартість перевезення', money(trip.price))}
    ${row('Термін оплати', date(trip.payment?.dueDate))}
    ${row('Відповідальний менеджер', escapeHtml(manager?.name))}
  </table>

  <div class="sign">
    <div>Замовник (підпис, печатка)</div>
    <div>Перевізник (підпис, печатка)</div>
  </div>
  <script>window.addEventListener('load', () => setTimeout(() => print(), 300));</script>
</body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.write(html);
  win.document.close();
  return true;
}

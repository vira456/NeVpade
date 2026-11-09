import { renderLayout } from '../utils/layout.js';
import { getTrips } from '../api/trips.js';
import { getDrivers } from '../api/drivers.js';
import { getVehicles } from '../api/vehicles.js';
import { money, km, TRIP_STATUS } from '../utils/format.js';
import { buildTripMessage, sendToViber, copyText } from '../utils/viber.js';

renderLayout();

let trips = [];
let drivers = [];
let vehicles = [];

function render(list) {
  document.getElementById('tripsBody').innerHTML = list
    .map(
      (t) => `
      <tr>
        <td>${t.number}</td>
        <td>${t.from.city} → ${t.to.city}</td>
        <td>${t.loadDate}</td>
        <td>${t.cargo.type}, ${t.cargo.weightT} т</td>
        <td>${km(t.distanceKm)}</td>
        <td>${money(t.price)}</td>
        <td><span class="badge badge--${t.status}">${TRIP_STATUS[t.status]}</span></td>
        <td>
          <button class="btn btn--ghost" data-viber="${t.id}">Viber</button>
          <button class="btn btn--ghost" data-copy="${t.id}">Копіювати</button>
        </td>
      </tr>`
    )
    .join('');
}

function messageFor(id) {
  const trip = trips.find((t) => t.id === id);
  return buildTripMessage(
    trip,
    drivers.find((d) => d.id === trip.driverId),
    vehicles.find((v) => v.id === trip.vehicleId)
  );
}

document.getElementById('tripsBody').addEventListener('click', async (e) => {
  const { viber, copy } = e.target.dataset;
  if (viber) sendToViber(messageFor(viber));
  if (copy) {
    await copyText(messageFor(copy));
    e.target.textContent = 'Скопійовано';
  }
});

document.getElementById('search').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  render(trips.filter((t) => `${t.number} ${t.from.city} ${t.to.city} ${t.cargo.type}`.toLowerCase().includes(q)));
});

async function init() {
  [trips, drivers, vehicles] = await Promise.all([getTrips(), getDrivers(), getVehicles()]);
  render(trips);
}

init();

import { renderLayout } from '../utils/layout.js';
import { getVehicles } from '../api/vehicles.js';
import { km, VEHICLE_STATUS } from '../utils/format.js';

renderLayout();

async function init() {
  const vehicles = await getVehicles();
  document.getElementById('fleetBody').innerHTML = vehicles
    .map(
      (v) => `
      <tr>
        <td>${v.plate}</td>
        <td>${v.model}</td>
        <td>${v.type}</td>
        <td>${v.capacityT} т</td>
        <td>${v.fuelConsumption} л/100 км</td>
        <td>${km(v.mileageKm)}</td>
        <td>${km(v.nextServiceKm)}</td>
        <td>${VEHICLE_STATUS[v.status]}</td>
      </tr>`
    )
    .join('');
}

init();

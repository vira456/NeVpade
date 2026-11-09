import { renderLayout } from '../utils/layout.js';
import { getTrips } from '../api/trips.js';

renderLayout();

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

function loadGoogleMaps() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&language=uk`;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function init() {
  const mapEl = document.getElementById('map');
  const select = document.getElementById('tripSelect');
  const trips = await getTrips();
  select.innerHTML = trips.map((t) => `<option value="${t.id}">${t.number}: ${t.from.city} → ${t.to.city}</option>`).join('');

  if (!KEY) {
    mapEl.innerHTML = '<p class="placeholder">Додай VITE_GOOGLE_MAPS_KEY у файл .env, щоб побачити карту.</p>';
    return;
  }

  await loadGoogleMaps();
  const map = new google.maps.Map(mapEl, { center: { lat: 49, lng: 31 }, zoom: 6 });
  const service = new google.maps.DirectionsService();
  const renderer = new google.maps.DirectionsRenderer({ map });

  const showRoute = (trip) =>
    service.route(
      {
        origin: { lat: trip.from.lat, lng: trip.from.lng },
        destination: { lat: trip.to.lat, lng: trip.to.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status !== 'OK') return;
        renderer.setDirections(result);
        const leg = result.routes[0].legs[0];
        document.getElementById('routeInfo').textContent = `${leg.distance.text}, ${leg.duration.text}`;
      }
    );

  select.addEventListener('change', () => showRoute(trips.find((t) => t.id === select.value)));
  showRoute(trips[0]);
}

init();

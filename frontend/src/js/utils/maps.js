// Робота з Google Maps.
// 1) Є ключ VITE_GOOGLE_MAPS_KEY → повноцінний Google Maps JavaScript API (маршрут, відстань, час у дорозі).
// 2) Ключа немає або він недійсний → вбудована карта Google (iframe) без ключа, щоб сторінка працювала одразу.

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

export const hasApiKey = Boolean(KEY);

// Координати, а якщо їх немає (рейс з Della) — текстова адреса, Google знайде її сам
export const place = (p) => {
  if (p.lat != null && p.lng != null) return { lat: p.lat, lng: p.lng };
  const parts = /обл|район|р-н/i.test(p.address ?? '') ? [p.city, p.address] : [p.address, p.city]; // «Ковель, Волинська обл.» / «вул. …, Львів»
  return [...parts, 'Україна'].filter(Boolean).join(', ');
};
const point = (p) => {
  const v = place(p);
  return typeof v === 'string' ? encodeURIComponent(v) : `${v.lat},${v.lng}`;
};

// Офіційний формат посилання Google Maps (працює і в браузері, і в застосунку на телефоні)
export const directionsUrl = (from, to) =>
  `https://www.google.com/maps/dir/?api=1&origin=${point(from)}&destination=${point(to)}&travelmode=driving`;

// Вбудована карта з маршрутом (не потребує ключа)
export const embedUrl = (from, to) =>
  `https://maps.google.com/maps?saddr=${point(from)}&daddr=${point(to)}&hl=uk&output=embed`;

let loading;
const authFailureHandlers = [];

// Google може повідомити про недійсний ключ уже ПІСЛЯ завантаження карти — підписуємось на це
export const onAuthFailure = (handler) => authFailureHandlers.push(handler);

// Завантажує скрипт Google Maps один раз. Відхиляє проміс, якщо ключ недійсний.
export function loadGoogleMaps() {
  if (!KEY) return Promise.reject(new Error('Немає ключа Google Maps'));
  if (window.google?.maps) return Promise.resolve(window.google.maps);

  loading ??= new Promise((resolve, reject) => {
    // Google викликає цю функцію, якщо ключ недійсний або API не увімкнено
    window.gm_authFailure = () => {
      const err = new Error('Ключ Google Maps недійсний або Maps JavaScript API не увімкнено');
      reject(err);
      authFailureHandlers.forEach((h) => h(err));
    };
    window.__onGoogleMapsLoaded = () => resolve(window.google.maps);

    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${KEY}&language=uk&region=UA&callback=__onGoogleMapsLoaded`;
    s.async = true;
    s.onerror = () => reject(new Error('Не вдалося завантажити Google Maps. Перевірте інтернет'));
    document.head.appendChild(s);
  });
  return loading;
}

// «7 год 5 хв» з секунд
export function formatDuration(sec) {
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  return h ? `${h} год ${min % 60} хв` : `${min} хв`;
}

// Орієнтовний час у дорозі для вантажівки, якщо API недоступний (≈ 65 км/год)
export const estimateDuration = (km) => formatDuration((km / 65) * 3600);

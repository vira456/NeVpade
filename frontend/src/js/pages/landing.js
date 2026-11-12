// Стартова сторінка: для гостя — «Почати роботу» й «Увійти», для того, хто вже увійшов, — «Відкрити кабінет»
import '../i18n/index.js';
import { isLoggedIn, getCurrentUser, nextPageFor } from '../api/auth.js';
import { renderPrefs } from '../utils/prefs-ui.js';
import { truckSvg } from '../utils/truck.js';
import { countUp } from '../utils/motion.js';
import '../utils/loader.js';

document.getElementById('lpTruck').innerHTML = truckSvg;

// Цифри в табло «набігають», коли воно з'являється на екрані
const preview = document.querySelector('.preview');
if (preview) {
  new IntersectionObserver((entries, obs) => {
    if (!entries[0].isIntersecting) return;
    preview.classList.add('is-visible');
    preview.querySelectorAll('.preview__stats dd').forEach((dd) => countUp(dd, { duration: 1200 }));
    obs.disconnect();
  }, { threshold: 0.35 }).observe(preview);
}

renderPrefs(document.getElementById('lpPrefs'));

if (isLoggedIn()) {
  const target = nextPageFor(getCurrentUser());
  document.querySelectorAll('[data-guest]').forEach((el) => (el.hidden = true));
  document.querySelectorAll('[data-user]').forEach((el) => (el.hidden = false));
  document.querySelectorAll('[data-app-link]').forEach((a) => (a.href = target));
}

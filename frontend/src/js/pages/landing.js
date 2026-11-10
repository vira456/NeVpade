// Стартова сторінка: для гостя — «Почати роботу» й «Увійти», для того, хто вже увійшов, — «Відкрити кабінет»
import '../i18n/index.js';
import '../../scss/main.scss';
import { isLoggedIn, getCurrentUser, nextPageFor } from '../api/auth.js';
import { renderPrefs } from '../utils/prefs-ui.js';

renderPrefs(document.getElementById('lpPrefs'));

if (isLoggedIn()) {
  const target = nextPageFor(getCurrentUser());
  document.querySelectorAll('[data-guest]').forEach((el) => (el.hidden = true));
  document.querySelectorAll('[data-user]').forEach((el) => (el.hidden = false));
  document.querySelectorAll('[data-app-link]').forEach((a) => (a.href = target));
}

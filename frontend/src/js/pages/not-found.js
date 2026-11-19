// Сторінка 404: увійшов користувач — ведемо в аналітику, гість — на лендинг
import '../i18n/index.js';
import { isLoggedIn, getCurrentUser, homeFor, OWNER_HOME } from '../api/auth.js';

if (isLoggedIn()) {
  const home = document.getElementById('lostHome');
  home.href = homeFor(getCurrentUser());
  home.textContent = home.href.endsWith(OWNER_HOME) ? 'До кабінету власника' : 'До аналітики';
}

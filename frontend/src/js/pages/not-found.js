// Сторінка 404: увійшов користувач — ведемо в аналітику, гість — на лендинг
import '../i18n/index.js';
import { isLoggedIn } from '../api/auth.js';

if (isLoggedIn()) {
  const home = document.getElementById('lostHome');
  home.href = '/pages/dashboard.html';
  home.textContent = 'До аналітики';
}

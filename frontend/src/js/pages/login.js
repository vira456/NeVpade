import '../../scss/main.scss';
import { login } from '../api/auth.js';

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const error = document.getElementById('loginError');
  try {
    await login(form.get('email'), form.get('password'));
    location.href = '/index.html';
  } catch (err) {
    error.textContent = err.message;
  }
});

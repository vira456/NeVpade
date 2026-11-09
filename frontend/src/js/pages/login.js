import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { login } from '../api/auth.js';
import { initSocialButtons } from '../utils/social.js';
import { isEmail, setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('loginForm');
const email = form.elements.email;
const password = form.elements.password;

// Повідомлення після реєстрації / зміни пароля
const notice = sessionStorage.getItem('authNotice');
if (notice) {
  showAlert(form, notice, 'success');
  sessionStorage.removeItem('authNotice');
}

const goHome = () => location.replace('/index.html');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  let ok = true;
  if (!isEmail(email.value)) (setFieldError(email, 'Введіть коректний email'), (ok = false));
  if (!password.value) (setFieldError(password, 'Введіть пароль'), (ok = false));
  if (!ok) return;

  try {
    await withLoading(form.querySelector('[type=submit]'), () => login(email.value.trim(), password.value));
    goHome();
  } catch (err) {
    // Бекенд повертає code: "email_not_verified", якщо пошту ще не підтверджено
    if (err.code === 'email_not_verified') {
      rememberEmail(email.value.trim());
      location.href = `/pages/verify-email.html?email=${encodeURIComponent(email.value.trim())}`;
      return;
    }
    showAlert(form, err.message);
  }
});

initSocialButtons({ onSuccess: goHome, onError: (msg) => showAlert(form, msg) });

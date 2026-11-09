import { initAuthPage, rememberEmail } from '../utils/auth-page.js';
import { register } from '../api/auth.js';
import { initSocialButtons } from '../utils/social.js';
import { isEmail, passwordProblems, setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('registerForm');
const { name, email, password, confirm, terms } = form.elements;
const rules = document.getElementById('passwordRules');

// Підказки до пароля в реальному часі
password.addEventListener('input', () => {
  const problems = passwordProblems(password.value);
  rules.querySelectorAll('li').forEach((li) => {
    li.classList.toggle('is-ok', !problems.includes(li.dataset.rule));
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);

  let ok = true;
  const fail = (input, msg) => (setFieldError(input, msg), (ok = false));

  if (name.value.trim().length < 2) fail(name, "Введіть ім'я (мінімум 2 символи)");
  if (!isEmail(email.value)) fail(email, 'Введіть коректний email');
  const problems = passwordProblems(password.value);
  if (problems.length) fail(password, `Пароль має містити: ${problems.join(', ')}`);
  if (confirm.value !== password.value) fail(confirm, 'Паролі не збігаються');
  if (!terms.checked) fail(terms, 'Потрібна згода на обробку даних');
  if (!ok) return;

  try {
    const cleanEmail = email.value.trim().toLowerCase();
    await withLoading(form.querySelector('[type=submit]'), () =>
      register({ name: name.value.trim(), email: cleanEmail, password: password.value })
    );
    rememberEmail(cleanEmail);
    location.href = `/pages/verify-email.html?email=${encodeURIComponent(cleanEmail)}`;
  } catch (err) {
    if (err.status === 409) setFieldError(email, 'Користувач з таким email вже існує');
    else showAlert(form, err.message);
  }
});

initSocialButtons({ onSuccess: () => location.replace('/index.html'), onError: (msg) => showAlert(form, msg) });

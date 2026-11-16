import { initAuthPage, recallEmail, initCodeInputs, startCooldown } from '../utils/auth-page.js';
import { forgotPassword, resetPassword, resendCode } from '../api/auth.js';
import { isEmail, passwordProblems, setFieldError, clearErrors, showAlert, withLoading } from '../utils/validation.js';

initAuthPage();

// Крок 1: email
const emailForm = document.getElementById('emailForm');
// Крок 2: код + новий пароль
const resetForm = document.getElementById('resetForm');
const resendBtn = document.getElementById('resendBtn');
let email = recallEmail();
emailForm.elements.email.value = email;

const code = initCodeInputs(document.getElementById('codeInputs'));

emailForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(emailForm);
  const input = emailForm.elements.email;
  if (!isEmail(input.value)) return setFieldError(input, 'Введіть коректний email');

  email = input.value.trim().toLowerCase();
  try {
    await withLoading(emailForm.querySelector('[type=submit]'), () => forgotPassword(email));
    emailForm.hidden = true;
    resetForm.hidden = false;
    document.getElementById('emailLabel').textContent = email;
    startCooldown(resendBtn);
    code.clear();
  } catch (err) {
    showAlert(emailForm, err.message);
  }
});

resetForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(resetForm);
  code.setError(false);
  const { password, confirm } = resetForm.elements;

  let ok = true;
  if (code.value().length !== 6) (code.setError(true), showAlert(resetForm, 'Введіть усі 6 цифр коду'), (ok = false));
  const problems = passwordProblems(password.value);
  if (problems.length) (setFieldError(password, `Пароль має містити: ${problems.join(', ')}`), (ok = false));
  if (confirm.value !== password.value) (setFieldError(confirm, 'Паролі не збігаються'), (ok = false));
  if (!ok) return;

  try {
    await withLoading(resetForm.querySelector('[type=submit]'), () => resetPassword(email, code.value(), password.value));
    sessionStorage.setItem('authNotice', 'Пароль змінено. Увійдіть з новим паролем.');
    location.replace('/pages/login.html');
  } catch (err) {
    code.setError(true);
    showAlert(resetForm, err.message);
  }
});

resendBtn.addEventListener('click', async () => {
  try {
    await resendCode(email, 'reset');
    showAlert(resetForm, 'Новий код надіслано', 'success');
    startCooldown(resendBtn);
  } catch (err) {
    showAlert(resetForm, err.message);
  }
});

document.getElementById('backBtn').addEventListener('click', () => {
  resetForm.hidden = true;
  emailForm.hidden = false;
});

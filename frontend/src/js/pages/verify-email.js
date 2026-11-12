import { initAuthPage, recallEmail, initCodeInputs, startCooldown } from '../utils/auth-page.js';
import { verifyEmail, resendCode } from '../api/auth.js';
import { showAlert, clearErrors, withLoading } from '../utils/validation.js';

initAuthPage();

const form = document.getElementById('verifyForm');
const email = recallEmail();
const resendBtn = document.getElementById('resendBtn');
const submitBtn = form.querySelector('[type=submit]');

if (!email) location.replace('/pages/register.html');
document.getElementById('emailLabel').textContent = email;

const code = initCodeInputs(document.getElementById('codeInputs'), () => form.requestSubmit());
startCooldown(resendBtn);

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearErrors(form);
  code.setError(false);

  if (code.value().length !== 6) {
    code.setError(true);
    showAlert(form, 'Введіть усі 6 цифр коду');
    return;
  }

  try {
    const res = await withLoading(submitBtn, () => verifyEmail(email, code.value()));
    // Далі — підтвердження телефону кодом з SMS
    sessionStorage.setItem('pendingPhone', res.phone);
    location.replace(`/pages/verify-phone.html?email=${encodeURIComponent(email)}`);
  } catch (err) {
    code.setError(true);
    code.clear();
    showAlert(form, err.message);
  }
});

resendBtn.addEventListener('click', async () => {
  clearErrors(form);
  try {
    await resendCode(email);
    showAlert(form, 'Новий код надіслано на пошту', 'success');
    startCooldown(resendBtn);
  } catch (err) {
    showAlert(form, err.message);
  }
});

// Вхід і реєстрація через Google — для менеджера й для власника.
// Якщо ключі не задані в .env (або увімкнено моки) — кнопки імітують вхід, щоб інтерфейс працював автономно.
import { isMockMode } from '../api/client.js';
import { loginWithGoogle } from '../api/auth.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Не вдалося завантажити ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * @param {{ onSuccess: (user) => void, onError: (message: string, err?: Error & { code?: string }) => void, getCompanyCode?: () => string, getRole?: () => string }} handlers
 *   getCompanyCode — код компанії з поля на сторінці входу (наявний менеджер входить лише з ним);
 *   getRole — 'manager' або 'owner': хто входить чи реєструється
 */
export async function initSocialButtons({ onSuccess, onError, text = 'continue_with', getCompanyCode = () => undefined, getRole = () => 'manager' }) {
  const googleBtn = document.getElementById('googleBtn');
  const googleSlot = document.getElementById('googleSlot');

  const run = async (fn) => {
    try {
      onSuccess(await fn());
    } catch (err) {
      onError(err.message, err); // err.code — щоб сторінка підсвітила потрібне поле
    }
  };

  // ----- Google -----
  if (GOOGLE_CLIENT_ID && !isMockMode) {
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => run(() => loginWithGoogle(resp.credential, { companyCode: getCompanyCode(), role: getRole() })),
      });
      // Офіційна кнопка Google замість нашої
      googleBtn.hidden = true;
      google.accounts.id.renderButton(googleSlot, {
        theme: 'outline',
        size: 'large',
        width: googleSlot.offsetWidth || 320,
        text, // signin_with на вході, signup_with на реєстрації
        locale: document.documentElement.lang === 'en' ? 'en' : 'uk',
      });
    } catch (err) {
      onError(err.message);
    }
  } else {
    googleBtn.addEventListener('click', () => run(() => loginWithGoogle('mock-google-credential', { companyCode: getCompanyCode(), role: getRole() })));
  }

}

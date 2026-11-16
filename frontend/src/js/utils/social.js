// Вхід через Google і Facebook.
// Якщо ключі не задані в .env (або увімкнено моки) — кнопки імітують вхід, щоб інтерфейс працював автономно.
import { isMockMode } from '../api/client.js';
import { loginWithGoogle, loginWithFacebook } from '../api/auth.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const FACEBOOK_APP_ID = import.meta.env.VITE_FACEBOOK_APP_ID;

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
 * @param {{ onSuccess: (user) => void, onError: (message: string) => void }} handlers
 */
export async function initSocialButtons({ onSuccess, onError, text = 'continue_with' }) {
  const googleBtn = document.getElementById('googleBtn');
  const googleSlot = document.getElementById('googleSlot');
  const facebookBtn = document.getElementById('facebookBtn');

  const run = async (fn) => {
    try {
      onSuccess(await fn());
    } catch (err) {
      onError(err.message);
    }
  };

  // ----- Google -----
  if (GOOGLE_CLIENT_ID && !isMockMode) {
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (resp) => run(() => loginWithGoogle(resp.credential)),
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
    googleBtn.addEventListener('click', () => run(() => loginWithGoogle('mock-google-credential')));
  }

  // ----- Facebook -----
  if (FACEBOOK_APP_ID && !isMockMode) {
    loadScript('https://connect.facebook.net/uk_UA/sdk.js')
      .then(() => FB.init({ appId: FACEBOOK_APP_ID, cookie: false, xfbml: false, version: 'v19.0' }))
      .catch((err) => onError(err.message));

    facebookBtn.addEventListener('click', () => {
      if (!window.FB) return onError('Facebook ще завантажується, спробуйте за мить');
      FB.login(
        (resp) => {
          if (resp.authResponse) run(() => loginWithFacebook(resp.authResponse.accessToken));
          else onError('Вхід через Facebook скасовано');
        },
        { scope: 'email,public_profile' }
      );
    });
  } else {
    facebookBtn.addEventListener('click', () => run(() => loginWithFacebook('mock-facebook-token')));
  }
}

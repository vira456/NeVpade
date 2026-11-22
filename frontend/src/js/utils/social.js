// Кнопка Google на вході й реєстрації (і для менеджера, і для власника).
// Google повертає credential — підписаний JWT з ім'ям, поштою й фото. Сторінка лише читає з нього дані,
// щоб заповнити форму; справжність підпису перевіряє сервер.
// Якщо VITE_GOOGLE_CLIENT_ID не задано (або увімкнено моки) — кнопка імітує вхід, щоб інтерфейс працював автономно.
import { isMockMode } from '../api/client.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// Демо-акаунти Google для режиму моків: окремий для власника й для менеджера
const MOCK_PROFILES = {
  owner: { name: 'Андрій Мельник', givenName: 'Андрій', familyName: 'Мельник', email: 'andriy.melnyk@gmail.com', picture: null, emailVerified: true },
  manager: { name: 'Олена Коваль', givenName: 'Олена', familyName: 'Коваль', email: 'olena.koval@gmail.com', picture: null, emailVerified: true },
};
export const mockGoogleCredential = (role = 'manager') => `mock-google-${role === 'owner' ? 'owner' : 'manager'}`;

/** Дані людини з credential Google: { name, givenName, familyName, email, picture, emailVerified } або null */
export function googleProfile(credential) {
  const mock = /^mock-google-(owner|manager)$/.exec(credential ?? '');
  if (mock) return { ...MOCK_PROFILES[mock[1]] };
  try {
    const part = credential.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = new TextDecoder().decode(Uint8Array.from(atob(part.padEnd(part.length + ((4 - (part.length % 4)) % 4), '=')), (c) => c.charCodeAt(0)));
    const p = JSON.parse(json);
    return {
      name: p.name ?? [p.given_name, p.family_name].filter(Boolean).join(' '),
      givenName: p.given_name ?? '',
      familyName: p.family_name ?? '',
      email: String(p.email ?? '').toLowerCase(),
      picture: p.picture ?? null,
      emailVerified: p.email_verified !== false,
    };
  } catch {
    return null;
  }
}

// Credential Google між сторінками: зі сторінки входу на реєстрацію, якщо акаунта ще немає
const STASH = 'nevpade.googleSignup';
export function stashGoogleCredential(credential) {
  try {
    sessionStorage.setItem(STASH, credential);
  } catch {
    /* приватний режим — людина просто натисне кнопку Google ще раз */
  }
}
export function takeGoogleCredential() {
  try {
    const c = sessionStorage.getItem(STASH);
    sessionStorage.removeItem(STASH);
    return c;
  } catch {
    return null;
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Не вдалося завантажити Google. Перевірте інтернет'));
    document.head.appendChild(s);
  });
}

/**
 * Кнопка Google: викликає onCredential(credential), коли людина обрала акаунт.
 * @param {{ onCredential: (credential: string) => any, onError: (message: string) => void, text?: string, mockRole?: () => string }} o
 *   text — підпис офіційної кнопки: signin_with на вході, signup_with на реєстрації;
 *   mockRole — чий демо-акаунт імітувати в режимі моків ('owner' | 'manager')
 */
export async function initGoogleButton({ onCredential, onError, text = 'continue_with', mockRole = () => 'manager' }) {
  const googleBtn = document.getElementById('googleBtn');
  const googleSlot = document.getElementById('googleSlot');
  if (!googleBtn) return;

  const run = async (credential) => {
    try {
      await onCredential(credential);
    } catch (err) {
      onError(err.message);
    }
  };

  if (GOOGLE_CLIENT_ID && !isMockMode) {
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: (resp) => run(resp.credential) });
      // Офіційна кнопка Google замість нашої
      googleBtn.hidden = true;
      google.accounts.id.renderButton(googleSlot, {
        theme: 'outline',
        size: 'large',
        width: googleSlot.offsetWidth || 320,
        text,
        locale: document.documentElement.lang === 'en' ? 'en' : 'uk',
      });
    } catch (err) {
      onError(err.message);
    }
  } else {
    googleBtn.addEventListener('click', () => run(mockGoogleCredential(mockRole())));
  }
}

// Профіль менеджера. У режимі моків дані зберігаються в localStorage,
// тож зміни не зникають після перезавантаження сторінки.
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';
import defaults from '../mock/profile.json';

// Пароль для перевірки «поточного пароля» в режимі моків
export const MOCK_PASSWORD = 'Manager2026';

const mockProfile = () => load('mock.profile') ?? { ...defaults.profile, language: load('lang', 'uk') };

// Оновлює ім'я/фото в боковому меню (дані про користувача в localStorage)
function syncCurrentUser(profile) {
  const user = getCurrentUser();
  if (!user) return;
  localStorage.setItem('user', JSON.stringify({ ...user, name: profile.fullName, avatarUrl: profile.avatarUrl }));
}

// ---------- Профіль ----------
export async function getProfile() {
  const profile = await request('/profile', { mock: mockProfile });
  syncCurrentUser(profile);
  return profile;
}

export async function updateProfile(data) {
  const profile = await request('/profile', {
    method: 'PUT',
    body: data,
    mock: () => {
      const updated = { ...mockProfile(), ...data };
      save('mock.profile', updated);
      return updated;
    },
  });
  syncCurrentUser(profile);
  return profile;
}

// image — dataURL (JPEG, вже зменшений до 256×256), null — видалити фото
export async function updateAvatar(image) {
  const profile = await request('/profile/avatar', {
    method: image ? 'PUT' : 'DELETE',
    body: image ? { image } : undefined,
    mock: () => {
      const updated = { ...mockProfile(), avatarUrl: image };
      if (!save('mock.profile', updated)) throw new ApiError('Не вдалося зберегти фото: замало місця в сховищі браузера', 0);
      return updated;
    },
  });
  syncCurrentUser(profile);
  return profile;
}

export const getKpi = () => request('/profile/kpi', { mock: defaults.kpi });

// ---------- Безпека ----------
export const changePassword = (currentPassword, newPassword) =>
  request('/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword },
    mock: () => {
      if (currentPassword !== (load('mock.password') ?? MOCK_PASSWORD)) {
        throw new ApiError('Невірний поточний пароль', 400, 'invalid_password');
      }
      save('mock.password', newPassword);
      return { message: 'Пароль змінено' };
    },
  });

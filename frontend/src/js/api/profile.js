// Профіль менеджера. У режимі моків дані зберігаються в localStorage,
// тож зміни не зникають після перезавантаження сторінки.
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';
import defaults from '../mock/profile.json';
import { mockTrips } from './mock-store.js';

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

// Показники менеджера — з його рейсів
export const getKpi = () =>
  request('/profile/kpi', {
    mock: () => {
      const me = getCurrentUser()?.id ?? 'usr_01';
      const mine = mockTrips().filter((t) => t.managerId === me);
      const done = mine.filter((t) => t.status === 'done');
      const month = new Date().toISOString().slice(0, 7);
      const withPayment = done.filter((t) => t.payment?.dueDate);
      const onTime = withPayment.filter((t) => t.payment.paidAt && t.payment.paidAt <= t.payment.dueDate).length;
      const drivers = new Set(mine.filter((t) => ['planned', 'in_progress'].includes(t.status) && t.driverId).map((t) => t.driverId));
      return {
        tripsCount: done.length,
        tripsThisMonth: done.filter((t) => t.loadDate.startsWith(month)).length,
        paidOnTime: withPayment.length ? Math.round((onTime / withPayment.length) * 100) : null,
        activeDrivers: drivers.size,
      };
    },
  });

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

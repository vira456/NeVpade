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
// Сервер може назвати ім'я name замість fullName — сторінки працюють з fullName
const normalizeProfile = (p) => ({ ...p, fullName: p?.fullName ?? p?.name ?? '', avatarUrl: p?.avatarUrl ?? null });

export async function getProfile() {
  const profile = normalizeProfile(await request('/profile', { mock: mockProfile }));
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
  }).then(normalizeProfile);
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

// Показники менеджера — з його рейсів (однаково для свого профілю й профілю колеги)
export function kpiFromTrips(trips, managerId) {
  const mine = trips.filter((t) => t.managerId === managerId);
  const done = mine.filter((t) => t.status === 'done');
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const withPayment = done.filter((t) => t.payment?.dueDate);
  const onTime = withPayment.filter((t) => t.payment.paidAt && t.payment.paidAt <= t.payment.dueDate).length;
  const active = mine.filter((t) => ['planned', 'in_progress'].includes(t.status));
  return {
    tripsCount: done.length,
    tripsThisMonth: done.filter((t) => t.loadDate.startsWith(month)).length,
    paidOnTime: withPayment.length ? Math.round((onTime / withPayment.length) * 100) : null,
    activeDrivers: new Set(active.filter((t) => t.driverId).map((t) => t.driverId)).size,
    activeTrips: active.length,
    revenueThisMonth: mine.filter((t) => ['done', 'in_progress'].includes(t.status) && t.loadDate.startsWith(month)).reduce((s, t) => s + (t.price || 0), 0),
  };
}

// Якщо сервер повернув старий формат (без tripsThisMonth / paidOnTime) або не має ендпоінта —
// рахуємо показники самі з /trips, щоб на сторінці не було «undefined»
const KPI_FIELDS = ['tripsCount', 'tripsThisMonth', 'paidOnTime', 'activeDrivers'];
async function withFallback(path, managerId, fields = KPI_FIELDS) {
  let kpi = null;
  try {
    kpi = await request(path, { mock: () => kpiFromTrips(mockTrips(), managerId) });
  } catch {
    // нема ендпоінта (404) — порахуємо нижче
  }
  if (kpi && fields.every((k) => k in kpi)) return kpi;
  const { getTrips } = await import('./trips.js');
  // те, що сервер таки повернув, лишаємо, решту дораховуємо
  const known = kpi ? Object.fromEntries(fields.filter((k) => k in kpi).map((k) => [k, kpi[k]])) : {};
  return { ...kpiFromTrips(await getTrips(), managerId), ...known };
}

export const getKpi = () => withFallback('/profile/kpi', getCurrentUser()?.id ?? 'usr_01');

/** Показники колеги — для сторінки «Профіль колеги» */
export const getMemberKpi = (memberId) =>
  withFallback(`/company/members/${memberId}/kpi`, memberId, [...KPI_FIELDS, 'activeTrips', 'revenueThisMonth']);

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

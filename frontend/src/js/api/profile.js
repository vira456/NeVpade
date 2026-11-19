// Профіль менеджера. У режимі моків дані зберігаються в localStorage,
// тож зміни не зникають після перезавантаження сторінки.
import { request, ApiError } from './client.js';
import { getCurrentUser, MOCK_PASSWORD } from './auth.js';
import { load, save } from '../utils/storage.js';
import defaults from '../mock/profile.json';
import companySeed from '../mock/company.json';
import { mockTrips } from './mock-store.js';

// Пароль для перевірки «поточного пароля» в режимі моків (той самий, що для входу в демо-акаунти)
export { MOCK_PASSWORD };

// У моках кожен демо-акаунт має свій профіль: Віра (usr_01) — mock.profile, колеги — mock.profile.<id>
export const mockProfileKey = (id = getCurrentUser()?.id ?? 'usr_01') => (id === 'usr_01' ? 'mock.profile' : `mock.profile.${id}`);
function mockProfile() {
  const saved = load(mockProfileKey());
  if (saved) return saved;
  const me = getCurrentUser();
  if (!me || me.id === 'usr_01') return { ...defaults.profile, language: load('lang', 'uk') };
  // колега з демо-компанії або менеджер, який щойно зареєструвався (тоді — з даних акаунта)
  const member = companySeed.members.find((m) => m.id === me.id) ?? { id: me.id, name: me.name, position: 'Менеджер з вантажоперевезень', email: me.email, phone: me.phone };
  return { id: member.id, fullName: member.name, position: member.position, email: member.email, phone: member.phone, language: load('lang', 'uk'), avatarUrl: null };
}

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
      save(mockProfileKey(), updated);
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
      if (!save(mockProfileKey(), updated)) throw new ApiError('Не вдалося зберегти фото: замало місця в сховищі браузера', 0);
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

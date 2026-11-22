import { request, ApiError } from './client.js';
import { load, save } from '../utils/storage.js';
import './mock-store.js'; // скидання застарілих демо-даних (MOCK_VERSION) — ще до першого входу
import companySeed from '../mock/company.json';

// У режимі моків правильний код підтвердження завжди такий:
export const MOCK_CODE = '123456';

// Код демо-компанії в режимі моків (власник може створити новий — див. mockCompanyCode)
export const MOCK_INVITE = 'NVP-4821';
const MOCK_COMPANY = 'ТОВ «Західтранс»';

// Пароль демо-акаунтів (той самий, що «поточний пароль» у профілі)
export const MOCK_PASSWORD = 'Manager2026';

/**
 * Дві окремі ролі з різними інтерфейсами:
 *  owner   — власник компанії: кабінет власника (огляд, менеджери, фінанси, компанія); входить поштою й паролем
 *  manager — менеджер: рейси, клієнти, автопарк, графік, завдання, чат; при кожному вході вводить
 *            код компанії, який бачить лише власник (той самий, що й при реєстрації)
 */
export const OWNER_HOME = '/pages/owner.html';
export const MANAGER_HOME = '/pages/dashboard.html';
export const PENDING_PAGE = '/pages/pending.html';

// Ролі в моках: початкові — з company.json, зміни (передача компанії) — у mock.roles
const mockRoleOf = (id, fallback) => (load('mock.roles') ?? {})[id] ?? fallback;

/** Роль користувача: owner або manager. Якщо сервер роль не віддав — шукаємо в демо-даних, інакше manager */
export function roleOf(user) {
  if (user?.role) return user.role;
  const id = String(user?.id ?? user?._id ?? 'usr_01');
  return mockRoleOf(id, companySeed.members.find((m) => m.id === id)?.role ?? 'manager');
}
export const homeFor = (user) => (roleOf(user) === 'owner' ? OWNER_HOME : MANAGER_HOME);

// ---------- Код компанії ----------
// Формат NVP-1234. Його бачить лише власник (кабінет → «Менеджери»); менеджер вводить код
// під час реєстрації і при кожному вході. Власник змінив код — менеджери входять уже з новим.
export function formatCompanyCode(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  return s.length > 3 ? `${s.slice(0, 3)}-${s.slice(3)}` : s;
}
export const isCompanyCode = (code) => /^[A-Z]{3}-\d{4}$/.test(code);
/** Поточний код демо-компанії (власник міг створити новий) */
export const mockCompanyCode = () => load('mock.companyInfo')?.inviteCode ?? MOCK_INVITE;

// У моках пароль зберігаємо лише як SHA-256 — навіть демо не тримає паролі відкритим текстом
async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Акаунти в моках: демо-компанія «Західтранс» (company.json, пароль MOCK_PASSWORD)
 * і власники, зареєстровані в цьому браузері (mock.owners, ключ — пошта).
 */
const seedByEmail = (email) =>
  load('mock.company') ? null : companySeed.members.find((m) => m.email.toLowerCase() === String(email).trim().toLowerCase());
const registeredOwner = (email) => (load('mock.owners') ?? {})[String(email).trim().toLowerCase()] ?? null;

/** Демо-акаунти для сторінки входу */
export const demoAccounts = () =>
  load('mock.company')
    ? []
    : companySeed.members
        .filter((m) => !(load('mock.removed') ?? []).includes(m.id))
        .map((m) => {
          const role = mockRoleOf(m.id, m.role);
          return { id: m.id, name: m.name, email: m.email, role };
        });

const mockUser = (email, name = 'Федорова Віра Дмитрівна', phone = '+380671234567', phoneVerified = true) => ({
  id: 'usr_01',
  name,
  email,
  phone,
  phoneVerified,
  role: 'manager',
  companyId: 'cmp_01',
  companyName: load('mock.companyInfo')?.name ?? MOCK_COMPANY,
});

const userFromMember = (m) => ({
  id: m.id,
  name: m.id === 'usr_01' ? load('mock.profile')?.fullName ?? m.name : load(`mock.profile.${m.id}`)?.fullName ?? m.name,
  email: m.email,
  phone: m.phone,
  phoneVerified: true,
  role: mockRoleOf(m.id, m.role),
  companyId: companySeed.company.id,
  companyName: load('mock.companyInfo')?.name ?? companySeed.company.name,
});

const userFromOwnerAccount = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  phone: a.phone,
  phoneVerified: true,
  role: 'owner',
  companyId: 'cmp_01',
  companyName: load('mock.companyInfo')?.name ?? a.companyName, // власник міг перейменувати компанію
});

// ---------- Менеджери, зареєстровані в цьому браузері, і заявки на вступ (моки) ----------
// Менеджер реєструється з кодом компанії → після підтвердження телефону з'являється заявка,
// і доки власник її не прийме, робочий простір закритий (memberStatus: 'pending').
const cleanMail = (email) => String(email ?? '').trim().toLowerCase();
const registeredManager = (email) => (load('mock.managers') ?? {})[cleanMail(email)] ?? null;
function saveManager(acc) {
  save('mock.managers', { ...(load('mock.managers') ?? {}), [acc.email]: acc });
  return acc;
}

const DEMO_REQUEST = () => ({
  id: 'jr_demo',
  userId: 'mgr_demo',
  name: 'Бондар Марія Олексіївна',
  email: 'm.bondar@gmail.com',
  phone: '+380679876543',
  createdAt: new Date(Date.now() - 2 * 3600e3).toISOString(),
  status: 'pending',
});
/** Усі заявки на вступ (у моках одна демо-заявка вже чекає, щоб власник одразу побачив, як це працює) */
export function mockJoinRequests() {
  let list = load('mock.joinRequests');
  if (!list) {
    list = [DEMO_REQUEST()];
    save('mock.joinRequests', list);
  }
  return list;
}
export const saveJoinRequests = (list) => save('mock.joinRequests', list);
/** Лише моки: власник прийняв/відхилив заявку — оновлюємо статус акаунта менеджера */
export function mockSetManagerStatus(email, status) {
  const acc = registeredManager(email);
  if (acc) saveManager({ ...acc, status });
}

function createJoinRequest(acc) {
  const list = mockJoinRequests().filter((r) => !(r.email === acc.email && r.status === 'pending'));
  list.push({ id: `jr_${Date.now().toString(36)}`, userId: acc.id, name: acc.name, email: acc.email, phone: acc.phone, createdAt: new Date().toISOString(), status: 'pending' });
  saveJoinRequests(list);
  return saveManager({ ...acc, status: 'pending' });
}

const userFromManagerAccount = (a) => ({
  id: a.id,
  name: a.name,
  email: a.email,
  phone: a.phone,
  phoneVerified: a.phoneVerified !== false,
  role: 'manager',
  companyId: 'cmp_01',
  companyName: load('mock.companyInfo')?.name ?? MOCK_COMPANY,
  memberStatus: a.status === 'unverified' ? 'pending' : a.status, // pending | active | rejected
});

// Захист від підбору пароля чи коду компанії: 5 невдалих спроб → пауза 15 хвилин (у моках — у межах вкладки)
function checkAttempts(email) {
  const rec = JSON.parse(sessionStorage.getItem(`mockLoginFails:${email}`) || '{"n":0,"until":0}');
  if (rec.until > Date.now()) {
    throw new ApiError('Забагато невдалих спроб. Вхід призупинено на 15 хвилин', 429, 'too_many_attempts');
  }
  return {
    fail() {
      rec.n += 1;
      if (rec.n >= 5) Object.assign(rec, { n: 0, until: Date.now() + 15 * 60000 });
      sessionStorage.setItem(`mockLoginFails:${email}`, JSON.stringify(rec));
    },
    ok: () => sessionStorage.removeItem(`mockLoginFails:${email}`),
  };
}

function checkMockCode(code) {
  if (code !== MOCK_CODE) throw new ApiError('Невірний код підтвердження', 400, 'invalid_code');
}

// ---------- Сесія ----------
export function saveSession({ token, user }) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('loginAt', new Date().toISOString()); // для блоку «Активна сесія»
}

export const getLoginTime = () => localStorage.getItem('loginAt');

export function getCurrentUser() {
  try {
    return JSON.parse(localStorage.getItem('user'));
  } catch {
    return null;
  }
}

export const isLoggedIn = () => Boolean(localStorage.getItem('token'));

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  localStorage.removeItem('loginAt');
  localStorage.removeItem('nevpade.sidebarSnapshot'); // у меню ім'я й компанія — не лишаємо після виходу
  location.href = '/pages/login.html';
}

// ---------- Вхід / реєстрація ----------
/**
 * Вхід. role — вкладка, яку обрав користувач: 'manager' або 'owner'.
 * Менеджер додатково вводить код компанії (companyCode), який дає йому власник: без нього в робочий простір
 * не зайти, навіть знаючи пароль, а власник може закрити доступ усім, просто змінивши код.
 * Власник входить поштою й паролем або через Google.
 * Помилки: 401 invalid_credentials, 401 invalid_company_code, 403 wrong_role (не та вкладка), 429 too_many_attempts
 */
export async function login(email, password, { role = 'manager', companyCode } = {}) {
  const data = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password, role, ...(role === 'manager' && { companyCode }) },
    mock: async () => {
      const clean = String(email).trim().toLowerCase();
      const member = seedByEmail(clean);
      const own = registeredOwner(clean);
      const mgr = registeredManager(clean);
      if ((member && (load('mock.removed') ?? []).includes(member.id)) || mgr?.status === 'removed') {
        throw new ApiError('Цей акаунт більше не має доступу до компанії. Зверніться до власника', 403, 'not_in_company');
      }
      const accRole = member ? mockRoleOf(member.id, member.role) : own ? mockRoleOf(own.id, 'owner') : 'manager';
      const attempts = checkAttempts(clean);
      const fail = (err) => {
        attempts.fail();
        throw err;
      };
      const badCredentials = () => fail(new ApiError('Невірна пошта або пароль', 401, 'invalid_credentials'));

      // Спершу пароль, а вже потім підказки про вкладку чи код — щоб без пароля не можна було дізнатися,
      // чи існує акаунт і яка в нього роль
      if (own && !own.passHash) throw new ApiError('Цей акаунт входить через Google — натисніть «Продовжити з Google»', 401, 'use_google');
      if (mgr && !mgr.passHash) {
        if (role === 'owner') badCredentials();
        throw new ApiError('Цей акаунт входить через Google — введіть код компанії й натисніть «Продовжити з Google»', 401, 'use_google');
      }
      const hash = own || mgr ? await sha256(password) : null;
      const passOk = own ? hash === own.passHash : mgr ? hash === mgr.passHash : member ? password === MOCK_PASSWORD : role === 'manager'; // інша пошта — демо-менеджер
      if (!passOk) badCredentials();

      if (role === 'owner') {
        if (accRole !== 'owner') throw new ApiError('Це акаунт менеджера. Оберіть вгорі «Менеджер» і введіть код компанії', 403, 'wrong_role');
        attempts.ok();
        return { token: `mock-token-${member?.id ?? own.id}`, user: member ? userFromMember(member) : userFromOwnerAccount(own) };
      }

      // вкладка «Менеджер»: пошта + пароль + код компанії
      if (accRole === 'owner') throw new ApiError('Це акаунт власника. Оберіть вгорі «Власник»', 403, 'wrong_role');
      if (mgr?.status === 'unverified') throw new ApiError('Пошту не підтверджено', 403, 'email_not_verified');
      if (formatCompanyCode(companyCode) !== mockCompanyCode()) {
        fail(new ApiError('Невірний код компанії. Уточніть актуальний код у власника', 401, 'invalid_company_code'));
      }
      attempts.ok();
      if (mgr) return { token: `mock-token-${mgr.id}`, user: userFromManagerAccount(mgr) }; // заявка ще чекає → «Очікуємо підтвердження»
      if (member) return { token: `mock-token-${member.id}`, user: userFromMember(member) };
      return { token: 'mock-token', user: mockUser(clean) }; // будь-яка інша пошта — демо-менеджер
    },
  });
  saveSession(data);
  return data.user;
}

/**
 * Актуальні дані про себе з сервера (GET /auth/me): роль чи компанію могли змінити,
 * поки користувач був на сайті. Збережені в браузері дані — лише кеш, рішення про доступ приймає сервер.
 */
export const getMe = () =>
  request('/auth/me', {
    mock: () => {
      const me = getCurrentUser();
      if (!me) throw new ApiError('Сесія закінчилась', 401, 'unauthorized');
      if ((load('mock.removed') ?? []).includes(me.id)) return { ...me, role: null, companyId: null, companyName: null };
      const mgr = registeredManager(me.email);
      // прибрали з компанії — без компанії (фронт поведе на «Завершіть реєстрацію», щоб приєднатися знову)
      if (mgr && mgr.id === me.id) return mgr.status === 'removed' ? { ...me, companyId: null, companyName: null, memberStatus: null } : userFromManagerAccount(mgr);
      // роль беремо з «бази» (демо-компанія + передачі компанії), а не з того, що збереглося в браузері
      const seedRole = companySeed.members.find((m) => m.id === me.id)?.role;
      return { ...me, role: mockRoleOf(me.id, me.id.startsWith('own_') ? 'owner' : seedRole ?? 'manager') };
    },
  });

/**
 * Оновити збережену сесію з /auth/me. Повертає { user, changed } або null, якщо сервер
 * ще не має /auth/me чи недоступний (тоді працюємо зі збереженими даними).
 */
export async function refreshSession() {
  const before = getCurrentUser();
  if (!before) return null;
  let fresh;
  try {
    fresh = await getMe();
  } catch {
    return null;
  }
  if (!fresh || typeof fresh !== 'object') return null;
  const user = { ...before, ...fresh, id: String(fresh.id ?? fresh._id ?? before.id) };
  localStorage.setItem('user', JSON.stringify(user));
  return {
    user,
    // порівнюємо те, що реально впливає на доступ (роль «не вказано» = та сама роль, що й з демо-даних)
    changed:
      roleOf(before) !== roleOf(user) ||
      String(before.companyId ?? '') !== String(user.companyId ?? '') ||
      (before.memberStatus ?? 'active') !== (user.memberStatus ?? 'active'),
  };
}

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту, потім телефон.
// Дві сторінки: register-owner.html — власник створює компанію ({ mode: 'create', name, city }),
// register.html — менеджер приєднується за кодом компанії ({ mode: 'join', code }) і чекає підтвердження власника
export const register = ({ name, email, phone, password, company }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, phone, password, company, role: company?.mode === 'create' ? 'owner' : 'manager' },
    mock: async () => {
      const clean = email.trim().toLowerCase();
      if (seedByEmail(clean) || registeredOwner(clean) || registeredManager(clean)) throw new ApiError('Користувач з таким email вже існує', 409, 'email_taken');
      if (company?.mode === 'join' && company.code.toUpperCase() !== mockCompanyCode()) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у власника', 404, 'company_not_found');
      }
      // щоб у моках показати введені дані
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      if (company?.mode === 'create') {
        // акаунт власника
        const owners = load('mock.owners') ?? {};
        owners[clean] = { id: `own_${Object.keys(owners).length + 1}`, name, email: clean, phone, passHash: await sha256(password), companyName: company.name };
        save('mock.owners', owners);
        // демо-дані «Західтранс» стають даними нової компанії, щоб кабінет не був порожнім
        save('mock.companyInfo', { name: company.name, createdAt: new Date().toISOString(), ...(company.city && { city: company.city }) });
      } else {
        // акаунт менеджера: заявка до власника з'явиться, щойно підтвердить пошту й телефон
        const n = Object.keys(load('mock.managers') ?? {}).length + 1;
        saveManager({ id: `mgr_${n}`, name, email: clean, phone, passHash: await sha256(password), status: 'unverified', phoneVerified: false });
      }
      return { email, message: 'Код підтвердження надіслано на пошту' };
    },
  });

// Крок 1: код з пошти. Токен ще не видається — далі SMS на телефон
// Відповідь: { next: "verify_phone", phone: "+380671234567" }
export const verifyEmail = (email, code) =>
  request('/auth/verify-email', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      return { next: 'verify_phone', phone: sessionStorage.getItem('mockPhone') || '+380671234567' };
    },
  });

// Крок 2: код з SMS → вхід у систему (менеджеру — заявка власнику на вступ)
export async function verifyPhone(email, code) {
  const data = await request('/auth/verify-phone', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      const own = registeredOwner(email);
      if (own) return { token: `mock-token-${own.id}`, user: userFromOwnerAccount(own) };
      let mgr = registeredManager(email);
      if (mgr) {
        mgr = saveManager({ ...mgr, phoneVerified: true, phone: sessionStorage.getItem('mockPhone') || mgr.phone });
        if (mgr.status === 'unverified') mgr = createJoinRequest(mgr); // власник побачить заявку в кабінеті
        return { token: `mock-token-${mgr.id}`, user: userFromManagerAccount(mgr) };
      }
      const phone = sessionStorage.getItem('mockPhone') || undefined;
      const name = sessionStorage.getItem('mockName') || getCurrentUser()?.name || undefined;
      return { token: 'mock-token', user: mockUser(email, name, phone) };
    },
  });
  saveSession(data);
  return data.user;
}

// Для входу через Google: соцмережа не дає телефон, тому користувач додає його окремо.
// Новий номер (або зміна номера) → SMS з кодом
export const addPhone = (email, phone) =>
  request('/auth/phone', {
    method: 'POST',
    auth: false,
    body: { email, phone },
    mock: () => {
      sessionStorage.setItem('mockPhone', phone);
      return { phone, message: 'Код надіслано в SMS' };
    },
  });

// Куди вести користувача після успішної авторизації.
// Новий користувач з Google ще без компанії → «Завершіть реєстрацію» (компанія + телефон),
// компанія є, але телефон не підтверджено → SMS-код, усе є → робочий простір
export function nextPageFor(user) {
  if (!user) return '/pages/login.html';
  if (!user.companyId) return '/pages/onboarding.html';
  // номер уже вказано (на кроці «Завершіть реєстрацію») → одразу поле для коду, інакше — спершу номер
  if (user.phoneVerified === false) return `/pages/verify-phone.html?mode=${user.phone ? 'social' : 'add'}&email=${encodeURIComponent(user.email)}`;
  // менеджер подав заявку з кодом компанії — доки власник не прийме, робочий простір закритий
  if (user.memberStatus && user.memberStatus !== 'active') return PENDING_PAGE;
  return homeFor(user);
}

// Реєстрацію не завершено — внутрішні сторінки ще недоступні
export const signupIncomplete = (user) => nextPageFor(user) !== homeFor(user);

/**
 * Завершити реєстрацію після входу через Google (користувач уже має токен).
 * Через Google реєструються лише менеджери (join за кодом компанії); власник — на сторінці «Реєстрація компанії».
 * Сервер прив'язує компанію, зберігає телефон і шле SMS-код.
 * Відповідь: { user, message } — user уже з companyId, але phoneVerified: false
 */
export async function completeSignup({ name, phone, company }) {
  const data = await request('/auth/complete-signup', {
    method: 'POST',
    body: { name, phone, company },
    mock: () => {
      const me = getCurrentUser();
      // власник через Google: створює компанію (назва, місто) і стає її власником
      if (company?.mode === 'create') {
        if (me?.role !== 'owner') throw new ApiError('Компанію створює власник на сторінці «Реєстрація компанії»', 400, 'owner_only');
        const owners = load('mock.owners') ?? {};
        const acc = { id: me.id, name, email: cleanMail(me.email), phone, passHash: null, google: true, companyName: company.name };
        owners[acc.email] = acc;
        save('mock.owners', owners);
        save('mock.companyInfo', { name: company.name, createdAt: new Date().toISOString(), ...(company.city && { city: company.city }) });
        sessionStorage.setItem('mockName', name);
        sessionStorage.setItem('mockPhone', phone);
        return { user: { ...userFromOwnerAccount(acc), phoneVerified: false }, message: 'Код надіслано в SMS' };
      }
      if (company?.mode !== 'join') throw new ApiError('Вкажіть код компанії', 400, 'company_required');
      if (company.code.toUpperCase() !== mockCompanyCode()) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у власника', 404, 'company_not_found');
      }
      const role = 'manager';
      const companyName = load('mock.companyInfo')?.name ?? MOCK_COMPANY;
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      // Google-акаунт менеджера: без пароля; заявка до власника — після підтвердження телефону
      saveManager({ id: me.id, name, email: cleanMail(me.email), phone, passHash: null, google: true, status: 'unverified', phoneVerified: false });
      const user = { ...me, name, phone, phoneVerified: false, role, companyId: 'cmp_01', companyName, memberStatus: 'pending' };
      return { user, message: 'Код надіслано в SMS' };
    },
  });
  localStorage.setItem('user', JSON.stringify(data.user));
  return data.user;
}

// purpose: verify (пошта) | verify_phone (SMS) | reset (відновлення пароля)
export const resendCode = (email, purpose = 'verify') =>
  request('/auth/resend-code', {
    method: 'POST',
    auth: false,
    body: { email, purpose },
    mock: { message: 'Код надіслано повторно' },
  });

/**
 * Нова заявка на вступ (заявку відхилили — менеджер вводить інший код). Потрібен токен.
 * Відповідь: { user } з memberStatus: 'pending'
 */
export async function requestJoin(code) {
  const data = await request('/auth/join-request', {
    method: 'POST',
    body: { code },
    mock: () => {
      if (String(code).toUpperCase() !== mockCompanyCode()) throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у власника', 404, 'company_not_found');
      const acc = registeredManager(getCurrentUser()?.email);
      if (!acc) throw new ApiError('Ви вже в цій компанії', 409, 'same_company');
      return { user: userFromManagerAccount(createJoinRequest(acc)) };
    },
  });
  localStorage.setItem('user', JSON.stringify({ ...getCurrentUser(), ...data.user }));
  return data.user;
}

// ---------- Відновлення пароля ----------
export const forgotPassword = (email) =>
  request('/auth/forgot-password', {
    method: 'POST',
    auth: false,
    body: { email },
    mock: { message: 'Якщо такий email зареєстровано, на нього надіслано код' },
  });

export const resetPassword = (email, code, password) =>
  request('/auth/reset-password', {
    method: 'POST',
    auth: false,
    body: { email, code, password },
    mock: () => {
      checkMockCode(code);
      return { message: 'Пароль змінено' };
    },
  });

// ---------- Соцмережі ----------
// Google: credential — ID-токен від Google Identity Services, бекенд перевіряє його підпис
export async function loginWithGoogle(credential, { companyCode, role = 'manager' } = {}) {
  const data = await request('/auth/google', {
    method: 'POST',
    auth: false,
    body: { credential, role, ...(role === 'manager' && companyCode && { companyCode }) },
    // Новий користувач — без компанії (код введе на «Завершіть реєстрацію»);
    // наявний менеджер, як і при вході паролем, має ввести код компанії
    mock: () => {
      // вкладка «Власник»: наявний власник — у кабінет; новий — «Завершіть реєстрацію» (назва, місто, телефон)
      if (role === 'owner') {
        const own = registeredOwner('andriy.melnyk@gmail.com');
        if (own) return { token: `mock-token-${own.id}`, user: userFromOwnerAccount(own) };
        return { token: 'mock-token-own_g', isNew: true, user: { id: 'own_g', name: 'Андрій Мельник', email: 'andriy.melnyk@gmail.com', phone: null, phoneVerified: false, role: 'owner', companyId: null, companyName: null } };
      }
      const acc = registeredManager('olena.koval@gmail.com');
      if (acc?.status === 'removed') throw new ApiError('Цей акаунт більше не має доступу до компанії. Зверніться до власника', 403, 'not_in_company');
      if (acc?.phoneVerified && formatCompanyCode(companyCode) !== mockCompanyCode()) {
        throw new ApiError('Невірний код компанії. Уточніть актуальний код у власника', 401, 'invalid_company_code');
      }
      if (acc?.phoneVerified) return { token: `mock-token-${acc.id}`, user: userFromManagerAccount(acc) };
      if (acc) return { token: `mock-token-${acc.id}`, user: { ...userFromManagerAccount(acc), phoneVerified: false } };
      return { token: 'mock-token-mgr_g', isNew: true, user: { ...mockUser('olena.koval@gmail.com', 'Олена Коваль', null, false), id: 'mgr_g', role: null, companyId: null, companyName: null } };
    },
  });
  saveSession(data);
  return data.user;
}

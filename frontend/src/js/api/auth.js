import { request, ApiError } from './client.js';
import { load, save } from '../utils/storage.js';
import './mock-store.js'; // скидання застарілих демо-даних (MOCK_VERSION) — ще до першого входу
import companySeed from '../mock/company.json';

// У режимі моків правильний код підтвердження завжди такий:
export const MOCK_CODE = '123456';

// Код запрошення тестової компанії в режимі моків
export const MOCK_INVITE = 'NVP-4821';
const MOCK_COMPANY = 'ТОВ «Західтранс»';

// Пароль демо-акаунтів (той самий, що «поточний пароль» у профілі)
export const MOCK_PASSWORD = 'Manager2026';
// Код власника демо-компанії (Ковальчук Андрій)
export const DEMO_OWNER_CODE = 'OWN-4821-7KQP';

/**
 * Дві окремі ролі з різними інтерфейсами:
 *  owner   — власник компанії: кабінет власника (огляд, менеджери, фінанси, компанія); входить з кодом власника
 *  manager — менеджер: рейси, клієнти, автопарк, графік, завдання, чат
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

// ---------- Код власника ----------
// Формат OWN-XXXX-XXXX: без схожих символів (0/O, 1/I/L), щоб його легко було переписати з папірця
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function formatOwnerCode(raw) {
  const s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OWN/, '').slice(0, 8);
  return s ? `OWN-${s.slice(0, 4)}${s.length > 4 ? `-${s.slice(4)}` : ''}` : '';
}
export const isOwnerCode = (code) => /^OWN-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code);
const newOwnerCode = () => {
  const rnd = crypto.getRandomValues(new Uint32Array(8));
  const chars = [...rnd].map((n) => CODE_ABC[n % CODE_ABC.length]).join('');
  return `OWN-${chars.slice(0, 4)}-${chars.slice(4)}`;
};

/** Лише моки: видати новий код власника (передача компанії) */
export function mockIssueOwnerCode(id) {
  const code = newOwnerCode();
  setOwnerCode(id, code);
  return code;
}

// Новий код показуємо власнику один раз (після реєстрації, передачі чи перевипуску)
const ONCE_KEY = 'nevpade.ownerCodeOnce';
export const takeOwnerCodeOnce = () => {
  const code = sessionStorage.getItem(ONCE_KEY);
  sessionStorage.removeItem(ONCE_KEY);
  return code;
};
const rememberOwnerCodeOnce = (code) => code && sessionStorage.setItem(ONCE_KEY, code);

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
const ownerCodeOf = (id) => (load('mock.ownerCodes') ?? {})[id] ?? (id === 'usr_00' ? DEMO_OWNER_CODE : null);
function setOwnerCode(id, code) {
  save('mock.ownerCodes', { ...(load('mock.ownerCodes') ?? {}), [id]: code });
}

/** Демо-акаунти для сторінки входу */
export const demoAccounts = () =>
  load('mock.company')
    ? []
    : companySeed.members
        .filter((m) => !(load('mock.removed') ?? []).includes(m.id))
        .map((m) => {
          const role = mockRoleOf(m.id, m.role);
          return { id: m.id, name: m.name, email: m.email, role, code: role === 'owner' ? ownerCodeOf(m.id) : null };
        });

const mockUser = (email, name = 'Федорова Віра Дмитрівна', phone = '+380671234567', phoneVerified = true) => ({
  id: 'usr_01',
  name,
  email,
  phone,
  phoneVerified,
  role: 'manager',
  companyId: 'cmp_01',
  companyName: load('mock.company')?.name || sessionStorage.getItem('mockCompany') || getCurrentUser()?.companyName || MOCK_COMPANY,
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
  companyName: a.companyName,
});

// ---------- Менеджери, зареєстровані в цьому браузері, і заявки на вступ (моки) ----------
// Менеджер реєструється з кодом запрошення → після підтвердження телефону з'являється заявка,
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

// Захист від підбору коду власника: 5 невдалих спроб → пауза 15 хвилин (у моках — у межах вкладки)
function checkAttempts(email) {
  const rec = JSON.parse(sessionStorage.getItem(`mockOwnerFails:${email}`) || '{"n":0,"until":0}');
  if (rec.until > Date.now()) {
    throw new ApiError('Забагато невдалих спроб. Вхід власника призупинено на 15 хвилин', 429, 'too_many_attempts');
  }
  return {
    fail() {
      rec.n += 1;
      if (rec.n >= 5) Object.assign(rec, { n: 0, until: Date.now() + 15 * 60000 });
      sessionStorage.setItem(`mockOwnerFails:${email}`, JSON.stringify(rec));
    },
    ok: () => sessionStorage.removeItem(`mockOwnerFails:${email}`),
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
 * Власник додатково вводить свій код (ownerCode): без нього кабінет не відкриється, навіть якщо пароль відомий.
 * Помилки: 401 invalid_credentials, 401 invalid_owner_code, 403 wrong_role (не та вкладка), 429 too_many_attempts
 */
export async function login(email, password, { role = 'manager', ownerCode } = {}) {
  const data = await request('/auth/login', {
    method: 'POST',
    auth: false,
    body: { email, password, role, ...(role === 'owner' && { ownerCode }) },
    mock: async () => {
      const clean = String(email).trim().toLowerCase();
      const member = seedByEmail(clean);
      const own = registeredOwner(clean);
      const mgr = registeredManager(clean);
      if ((member && (load('mock.removed') ?? []).includes(member.id)) || mgr?.status === 'removed') {
        throw new ApiError('Цей акаунт більше не має доступу до компанії. Зверніться до власника', 403, 'not_in_company');
      }
      const accRole = member ? mockRoleOf(member.id, member.role) : own ? mockRoleOf(own.id, 'owner') : 'manager';

      if (role === 'manager') {
        if (accRole === 'owner') throw new ApiError('Це акаунт власника. Оберіть вгорі «Власник» і введіть код власника', 403, 'wrong_role');
        if (mgr) {
          if (!mgr.passHash) throw new ApiError('Цей акаунт входить через Google — натисніть «Продовжити з Google»', 401, 'use_google');
          if ((await sha256(password)) !== mgr.passHash) throw new ApiError('Невірна пошта або пароль', 401, 'invalid_credentials');
          if (mgr.status === 'unverified') throw new ApiError('Пошту не підтверджено', 403, 'email_not_verified');
          return { token: `mock-token-${mgr.id}`, user: userFromManagerAccount(mgr) }; // заявка ще чекає → фронт покаже «Очікуємо підтвердження»
        }
        if (!member) return { token: 'mock-token', user: mockUser(clean) }; // будь-яка інша пошта — демо-менеджер
        if (password !== MOCK_PASSWORD) throw new ApiError('Невірна пошта або пароль', 401, 'invalid_credentials');
        return { token: `mock-token-${member.id}`, user: userFromMember(member) };
      }

      // вкладка «Власник»
      if (!member && !own) throw new ApiError('Невірна пошта або пароль', 401, 'invalid_credentials');
      if (accRole !== 'owner') throw new ApiError('Це акаунт менеджера. Оберіть вгорі «Менеджер»', 403, 'wrong_role');
      const attempts = checkAttempts(clean);
      const passOk = own ? (await sha256(password)) === own.passHash : password === MOCK_PASSWORD;
      if (!passOk) {
        attempts.fail();
        throw new ApiError('Невірна пошта або пароль', 401, 'invalid_credentials');
      }
      const id = member?.id ?? own.id;
      if (formatOwnerCode(ownerCode) !== (ownerCodeOf(id) ?? own?.code)) {
        attempts.fail();
        throw new ApiError('Невірний код власника', 401, 'invalid_owner_code');
      }
      attempts.ok();
      return { token: `mock-token-${id}`, user: member ? userFromMember(member) : userFromOwnerAccount(own) };
    },
  });
  saveSession(data);
  return data.user;
}

/** «Забули код власника?» — новий код надсилають на пошту власника, старий перестає діяти */
export const resetOwnerCode = (email) =>
  request('/auth/owner-code/reset', {
    method: 'POST',
    auth: false,
    body: { email },
    mock: () => {
      const clean = String(email).trim().toLowerCase();
      const member = seedByEmail(clean);
      const own = registeredOwner(clean);
      const id = member && mockRoleOf(member.id, member.role) === 'owner' ? member.id : own?.id;
      const res = { message: 'Якщо це акаунт власника, новий код надіслано на пошту' };
      if (!id) return res; // не підказуємо, чи існує такий власник
      const code = newOwnerCode();
      setOwnerCode(id, code);
      if (own) save('mock.owners', { ...load('mock.owners'), [clean]: { ...own, code } });
      return { ...res, mockCode: code }; // лише в моках: листа немає, тож показуємо код на екрані
    },
  });

/** Перевипустити код власника з кабінету (потрібен поточний пароль). Відповідь: { ownerCode } — показати один раз */
export const regenerateOwnerCode = (password) =>
  request('/auth/owner-code', {
    method: 'POST',
    body: { password },
    mock: async () => {
      const me = getCurrentUser();
      if (roleOf(me) !== 'owner') throw new ApiError('Ця дія доступна лише власнику компанії', 403, 'owner_only');
      const own = registeredOwner(me.email);
      const ok = own ? (await sha256(password)) === own.passHash : password === MOCK_PASSWORD;
      if (!ok) throw new ApiError('Невірний пароль', 400, 'wrong_password');
      const code = newOwnerCode();
      setOwnerCode(me.id, code);
      if (own) save('mock.owners', { ...load('mock.owners'), [own.email]: { ...own, code } });
      return { ownerCode: code };
    },
  });

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
      if (mgr && mgr.id === me.id) return userFromManagerAccount(mgr);
      return { ...me, role: mockRoleOf(me.id, me.id.startsWith('own_') ? 'owner' : me.role) };
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
    changed: before.role !== user.role || before.companyId !== user.companyId || (before.memberStatus ?? 'active') !== (user.memberStatus ?? 'active'),
  };
}

// Реєстрація НЕ видає токен: спершу треба підтвердити пошту, потім телефон.
// Роль обирають на початку форми: власник створює компанію ({ mode: 'create', name }),
// менеджер приєднується до наявної за кодом запрошення ({ mode: 'join', code })
export const register = ({ name, email, phone, password, company }) =>
  request('/auth/register', {
    method: 'POST',
    auth: false,
    body: { name, email, phone, password, company, role: company?.mode === 'create' ? 'owner' : 'manager' },
    mock: async () => {
      const clean = email.trim().toLowerCase();
      if (seedByEmail(clean) || registeredOwner(clean) || registeredManager(clean)) throw new ApiError('Користувач з таким email вже існує', 409, 'email_taken');
      if (company?.mode === 'join' && company.code.toUpperCase() !== MOCK_INVITE) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
      }
      // щоб у моках показати введені дані
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      sessionStorage.setItem('mockCompany', company?.mode === 'create' ? company.name : MOCK_COMPANY);
      if (company?.mode === 'create') {
        // акаунт власника: код видасть сервер після підтвердження телефону
        const owners = load('mock.owners') ?? {};
        owners[clean] = { id: `own_${Object.keys(owners).length + 1}`, name, email: clean, phone, passHash: await sha256(password), companyName: company.name, code: null };
        save('mock.owners', owners);
        // демо-дані «Західтранс» стають даними нової компанії, щоб кабінет не був порожнім
        save('mock.companyInfo', { name: company.name, ...(company.city && { city: company.city }) });
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

// Крок 2: код з SMS → вхід у систему.
// Власнику після першого підтвердження сервер один раз повертає ownerCode — показуємо його в кабінеті
export async function verifyPhone(email, code) {
  const data = await request('/auth/verify-phone', {
    method: 'POST',
    auth: false,
    body: { email, code },
    mock: () => {
      checkMockCode(code);
      const own = registeredOwner(email);
      if (own) {
        const ownerCode = own.code ?? newOwnerCode();
        save('mock.owners', { ...load('mock.owners'), [own.email]: { ...own, code: ownerCode } });
        return { token: `mock-token-${own.id}`, user: userFromOwnerAccount(own), ...(own.code ? {} : { ownerCode }) };
      }
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
  rememberOwnerCodeOnce(data.ownerCode);
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
  // менеджер подав заявку з кодом запрошення — доки власник не прийме, робочий простір закритий
  if (user.memberStatus && user.memberStatus !== 'active') return PENDING_PAGE;
  return homeFor(user);
}

// Реєстрацію не завершено — внутрішні сторінки ще недоступні
export const signupIncomplete = (user) => nextPageFor(user) !== homeFor(user);

/**
 * Завершити реєстрацію після входу через Google (користувач уже має токен).
 * Через соцмережі реєструються лише менеджери (join за кодом запрошення): власник входить поштою, паролем і кодом власника.
 * Сервер прив'язує компанію, зберігає телефон і шле SMS-код.
 * Відповідь: { user, message } — user уже з companyId, але phoneVerified: false
 */
export async function completeSignup({ name, phone, company }) {
  const data = await request('/auth/complete-signup', {
    method: 'POST',
    body: { name, phone, company },
    mock: () => {
      if (company?.mode !== 'join') throw new ApiError('Власник реєструється поштою й паролем — так він отримає код власника', 400, 'owner_needs_password');
      if (company.code.toUpperCase() !== MOCK_INVITE) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
      }
      const role = 'manager';
      const companyName = MOCK_COMPANY;
      sessionStorage.setItem('mockName', name);
      sessionStorage.setItem('mockPhone', phone);
      sessionStorage.setItem('mockCompany', companyName);
      const me = getCurrentUser();
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
      if (String(code).toUpperCase() !== MOCK_INVITE) throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у власника', 404, 'company_not_found');
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
export async function loginWithGoogle(credential) {
  const data = await request('/auth/google', {
    method: 'POST',
    auth: false,
    body: { credential },
    // У моках перший вхід — новий користувач без компанії; після реєстрації — звичайний вхід (зі статусом заявки)
    mock: () => {
      const acc = registeredManager('olena.koval@gmail.com');
      if (acc?.status === 'removed') throw new ApiError('Цей акаунт більше не має доступу до компанії. Зверніться до власника', 403, 'not_in_company');
      if (acc?.phoneVerified) return { token: `mock-token-${acc.id}`, user: userFromManagerAccount(acc) };
      if (acc) return { token: `mock-token-${acc.id}`, user: { ...userFromManagerAccount(acc), phoneVerified: false } };
      return { token: 'mock-token-mgr_g', isNew: true, user: { ...mockUser('olena.koval@gmail.com', 'Олена Коваль', null, false), id: 'mgr_g', role: null, companyId: null, companyName: null } };
    },
  });
  saveSession(data);
  return data.user;
}

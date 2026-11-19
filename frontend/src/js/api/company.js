// Компанія поточного менеджера та її учасники
import { request, ApiError } from './client.js';
import { getCurrentUser, roleOf, mockIssueOwnerCode, mockJoinRequests, saveJoinRequests, mockSetManagerStatus } from './auth.js';
import { load, save } from '../utils/storage.js';
import { freshSeed, mockTrips, saveTrips } from './mock-store.js';
import { mockProfileKey } from './profile.js';
import seed from '../mock/company.json';

// Демо-компанія «Західтранс» з колегами й рейсами. Якщо в демо перейти в нову компанію,
// її дані лежать у mock.company (поки що там лише ви), а рейси/машини/клієнти порожні.
const DEMO_INVITE = 'NVP-4821';
const otherCompany = () => load('mock.company');

// У моках «я» — перший учасник; ім'я/фото беремо з профілю, назву — з реєстрації
function mockMembers() {
  const me = getCurrentUser();
  const profile = load(mockProfileKey(me?.id ?? 'usr_01'));
  const roles = load('mock.roles') ?? {};
  const removed = load('mock.removed') ?? [];
  const other = otherCompany();
  // + менеджери, яких власник прийняв за заявками на вступ
  const list = [...(other ? other.members : freshSeed(seed.members)), ...(load('mock.joined') ?? [])].filter((m) => !removed.includes(m.id));
  return list.map((m) => {
    const member = { ...m, role: roles[m.id] ?? (m.id === me?.id && me?.role ? me.role : m.role) };
    return m.id === (me?.id ?? 'usr_01')
      ? { ...member, name: profile?.fullName ?? me?.name ?? m.name, avatarUrl: profile?.avatarUrl ?? null, online: true }
      : member;
  });
}

export const getCompany = () =>
  request('/company', {
    mock: () => otherCompany() ?? { ...freshSeed(seed.company), name: getCurrentUser()?.companyName || seed.company.name, ...(load('mock.companyInfo') ?? {}) },
  });

// Сервер на MongoDB може віддати _id замість id — вирівнюємо, щоб посилання на профілі працювали
const normalize = (m) => ({ ...m, id: String(m.id ?? m._id ?? m.userId ?? '') });
export const getMembers = () => request('/company/members', { mock: mockMembers }).then((list) => (list ?? []).map(normalize));

/**
 * Один колега — для сторінки «Профіль колеги».
 * Якщо на сервері ще немає GET /company/members/{id}, беремо людину зі списку /company/members.
 */
export async function getMember(id) {
  try {
    const one = await request(`/company/members/${id}`, {
      mock: () => {
        const m = mockMembers().find((x) => x.id === id);
        if (!m) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
        return m;
      },
    });
    return normalize(one);
  } catch (err) {
    if (err.code === 'member_not_found' || err.status === 401) throw err;
    const m = (await getMembers()).find((x) => x.id === String(id));
    if (!m) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
    return m;
  }
}

/**
 * Перейти в іншу компанію: { mode: 'join', code } або { mode: 'create', name }.
 * Сервер: активні рейси (заплановані й у дорозі) передаються власнику старої компанії,
 * виконані лишаються в історії старої компанії. Відповідь — оновлений користувач.
 */
export const switchCompany = (company) =>
  request('/company/switch', {
    method: 'POST',
    body: { company },
    mock: () => {
      const me = getCurrentUser();
      if (roleOf(me) === 'owner') throw new ApiError('Власник не змінює компанію, а передає її менеджеру', 403, 'manager_only');
      const inDemo = !otherCompany();
      if (company.mode !== 'join') throw new ApiError('Нову компанію створює власник під час реєстрації', 400, 'join_only');
      if (company.code !== DEMO_INVITE) {
        throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
      }
      if (inDemo) throw new ApiError('Ви вже в цій компанії', 409, 'same_company');
      // повертаємось у демо-компанію: її дані знову з початкових JSON
      ['company', 'companyInfo', 'removed', 'trips', 'vehicles', 'drivers', 'clients', 'tasks', 'chat', 'roles'].forEach((k) => localStorage.removeItem(`nevpade.mock.${k}`));
      // у новій компанії — заявка, доки власник не прийме
      const user = { ...me, role: 'manager', companyId: seed.company.id, companyName: seed.company.name, memberStatus: 'pending' };
      return { user, company: freshSeed(seed.company) };
    },
  }).then((res) => {
    localStorage.setItem('user', JSON.stringify(res.user));
    return res;
  });

/** Скільки активних рейсів у мене зараз (щоб попередити перед переходом) */
export const myActiveTrips = (trips, id = getCurrentUser()?.id) =>
  trips.filter((t) => t.managerId === id && ['planned', 'in_progress'].includes(t.status));

// Новий код запрошення (старий перестає діяти)
export const regenerateInvite = () =>
  request('/company/invite', {
    method: 'POST',
    mock: () => {
      assertOwner(); // новий код запрошення створює лише власник (з кабінету)
      return { inviteCode: `NVP-${Math.floor(1000 + Math.random() * 9000)}` };
    },
  });

// ---------- Кабінет власника ----------
const meId = () => String(getCurrentUser()?.id ?? 'usr_01');
function assertOwner() {
  if (roleOf(getCurrentUser()) !== 'owner') throw new ApiError('Ця дія доступна лише власнику компанії', 403, 'owner_only');
}

/** Змінити назву чи місто компанії (лише власник). data: { name?, city? } */
export const updateCompany = (data) =>
  request('/company', {
    method: 'PATCH',
    body: data,
    mock: () => {
      assertOwner();
      const name = data.name?.trim();
      if (data.name !== undefined && name.length < 2) throw new ApiError('Вкажіть назву компанії', 422, 'invalid_name');
      const other = otherCompany();
      const current = other ?? { ...freshSeed(seed.company), ...(load('mock.companyInfo') ?? {}) };
      const updated = { ...current, ...(name && { name }), ...(data.city !== undefined && { city: data.city?.trim() || null }) };
      if (other) save('mock.company', updated);
      else save('mock.companyInfo', { name: updated.name, city: updated.city });
      const me = getCurrentUser();
      localStorage.setItem('user', JSON.stringify({ ...me, companyName: updated.name }));
      return updated;
    },
  }).then((company) => {
    const me = getCurrentUser();
    if (me && company?.name) localStorage.setItem('user', JSON.stringify({ ...me, companyName: company.name }));
    return company;
  });

/**
 * Передати компанію менеджеру: він стає власником (сервер надсилає йому на пошту код власника),
 * а ви — менеджером і далі працюєте в інтерфейсі менеджера.
 * Відповідь: { user } — ви з новою роллю.
 */
export const transferOwnership = (memberId) =>
  request('/company/transfer-ownership', {
    method: 'POST',
    body: { memberId },
    mock: () => {
      const members = mockMembers();
      assertOwner();
      if (memberId === meId()) throw new ApiError('Ви вже власник компанії', 409, 'same_member');
      if (!members.some((m) => m.id === memberId)) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
      save('mock.roles', { ...(load('mock.roles') ?? {}), [memberId]: 'owner', [meId()]: 'manager' });
      const code = mockIssueOwnerCode(memberId); // у моках листа немає — код видно в демо-акаунтах на сторінці входу
      return { user: { ...getCurrentUser(), role: 'manager' }, mockCode: code };
    },
  }).then((res) => {
    if (res?.user) localStorage.setItem('user', JSON.stringify({ ...getCurrentUser(), ...res.user }));
    return res;
  });

/**
 * Прибрати менеджера з компанії (звільнення). Він втрачає доступ одразу.
 * Його активні рейси (planned / in_progress) переходять до transferTo — іншого менеджера;
 * без transferTo за наявності активних рейсів → 409 transfer_required. Виконані лишаються в історії.
 * Відповідь: { transferred: <скільки рейсів передано> }
 */
export const removeMember = (memberId, { transferTo = null } = {}) =>
  request(`/company/members/${memberId}${transferTo ? `?transferTo=${encodeURIComponent(transferTo)}` : ''}`, {
    method: 'DELETE',
    mock: () => {
      const members = mockMembers();
      assertOwner();
      if (memberId === meId()) throw new ApiError('Себе прибрати не можна — спершу передайте компанію колезі', 409, 'cannot_remove_self');
      if (!members.some((m) => m.id === memberId)) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
      const trips = mockTrips();
      const active = trips.filter((t) => t.managerId === memberId && ['planned', 'in_progress'].includes(t.status));
      if (active.length && !transferTo) throw new ApiError('Оберіть менеджера, якому перейдуть активні рейси', 409, 'transfer_required');
      if (transferTo && !members.some((m) => m.id === transferTo && m.role !== 'owner' && m.id !== memberId)) {
        throw new ApiError('Рейси можна передати лише іншому менеджеру компанії', 422, 'invalid_transfer');
      }
      active.forEach((t) => {
        (t.history ??= []).push({ at: new Date().toISOString(), by: meId(), action: 'transferred', from: memberId, to: transferTo });
        t.managerId = transferTo;
      });
      saveTrips(trips);
      save('mock.removed', [...(load('mock.removed') ?? []), memberId]);
      const gone = members.find((m) => m.id === memberId);
      if (gone?.email) mockSetManagerStatus(gone.email, 'removed');
      return { transferred: active.length };
    },
  });

// ---------- Заявки на вступ ----------
/**
 * Менеджери, які зареєструвались з кодом запрошення й чекають підтвердження (лише власник).
 * [{ id, userId, name, email, phone, createdAt, status: "pending" }]
 */
export const getJoinRequests = () =>
  request('/company/join-requests', {
    mock: () => {
      assertOwner();
      return mockJoinRequests().filter((r) => r.status === 'pending');
    },
  });

function decide(id, status) {
  assertOwner();
  const list = mockJoinRequests();
  const req = list.find((r) => r.id === id && r.status === 'pending');
  if (!req) throw new ApiError('Заявку вже розглянуто або скасовано', 404, 'request_not_found');
  req.status = status;
  req.decidedAt = new Date().toISOString();
  saveJoinRequests(list);
  mockSetManagerStatus(req.email, status === 'approved' ? 'active' : 'rejected');
  return req;
}

/** Прийняти менеджера: він одразу отримує доступ до робочого простору компанії. Відповідь — новий учасник */
export const approveJoinRequest = (id) =>
  request(`/company/join-requests/${id}/approve`, {
    method: 'POST',
    mock: () => {
      const req = decide(id, 'approved');
      const member = { id: req.userId, name: req.name, position: 'Менеджер з вантажоперевезень', email: req.email, phone: req.phone, online: false, lastSeen: null, role: 'manager' };
      save('mock.joined', [...(load('mock.joined') ?? []).filter((m) => m.id !== member.id), member]);
      save('mock.removed', (load('mock.removed') ?? []).filter((x) => x !== member.id));
      return member;
    },
  });

/** Відхилити заявку: людина побачить це й зможе ввести інший код */
export const rejectJoinRequest = (id) =>
  request(`/company/join-requests/${id}/reject`, {
    method: 'POST',
    mock: () => {
      decide(id, 'rejected');
      return { ok: true };
    },
  });

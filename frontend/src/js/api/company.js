// Компанія поточного менеджера та її учасники
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';
import { freshSeed } from './mock-store.js';
import seed from '../mock/company.json';

// Демо-компанія «Західтранс» з колегами й рейсами. Якщо в демо перейти в нову компанію,
// її дані лежать у mock.company (поки що там лише ви), а рейси/машини/клієнти порожні.
const DEMO_INVITE = 'NVP-4821';
const otherCompany = () => load('mock.company');

// У моках «я» — перший учасник; ім'я/фото беремо з профілю, назву — з реєстрації
function mockMembers() {
  const me = getCurrentUser();
  const profile = load('mock.profile');
  const roles = load('mock.roles') ?? {};
  const other = otherCompany();
  const list = other ? other.members : freshSeed(seed.members);
  return list.map((m) => {
    const member = { ...m, role: roles[m.id] ?? (m.id === me?.id && me?.role ? me.role : m.role) };
    return m.id === (me?.id ?? 'usr_01')
      ? { ...member, name: profile?.fullName ?? me?.name ?? m.name, avatarUrl: profile?.avatarUrl ?? null, online: true }
      : member;
  });
}

/** Змінити роль учасника (лише керівник). role: 'owner' — керівник, 'manager' — менеджер */
export const setMemberRole = (memberId, role) =>
  request(`/company/members/${memberId}/role`, {
    method: 'PATCH',
    body: { role },
    mock: () => {
      const members = mockMembers();
      const me = getCurrentUser();
      if (members.find((m) => m.id === (me?.id ?? 'usr_01'))?.role !== 'owner') {
        throw new ApiError('Змінювати ролі може лише керівник', 403, 'owner_only');
      }
      if (role !== 'owner' && members.filter((m) => m.role === 'owner' && m.id !== memberId).length === 0) {
        throw new ApiError('У компанії має лишитися хоча б один керівник', 409, 'last_owner');
      }
      save('mock.roles', { ...(load('mock.roles') ?? {}), [memberId]: role });
      if (memberId === me?.id) localStorage.setItem('user', JSON.stringify({ ...me, role }));
      return { ...members.find((m) => m.id === memberId), role };
    },
  });

export const getCompany = () =>
  request('/company', {
    mock: () => otherCompany() ?? { ...freshSeed(seed.company), name: getCurrentUser()?.companyName || seed.company.name },
  });

export const getMembers = () => request('/company/members', { mock: mockMembers });

/** Один колега — для сторінки «Профіль колеги» */
export const getMember = (id) =>
  request(`/company/members/${id}`, {
    mock: () => {
      const m = mockMembers().find((x) => x.id === id);
      if (!m) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
      return m;
    },
  });

/**
 * Перейти в іншу компанію: { mode: 'join', code } або { mode: 'create', name }.
 * Сервер: активні рейси (заплановані й у дорозі) передаються керівнику старої компанії,
 * виконані лишаються в історії старої компанії. Відповідь — оновлений користувач.
 */
export const switchCompany = (company) =>
  request('/company/switch', {
    method: 'POST',
    body: { company },
    mock: () => {
      const me = getCurrentUser();
      const members = mockMembers();
      const others = members.filter((m) => m.id !== me.id);
      const iAmOwner = members.find((m) => m.id === me.id)?.role === 'owner';
      const inDemo = !otherCompany();
      if (company.mode === 'join' && company.code === DEMO_INVITE && inDemo) throw new ApiError('Ви вже в цій компанії', 409, 'same_company');
      if (iAmOwner && others.length && !others.some((m) => m.role === 'owner')) {
        throw new ApiError('Ви єдиний керівник компанії. Спершу призначте керівником когось із колег у списку команди', 409, 'last_owner');
      }
      if (company.mode === 'join') {
        if (company.code !== DEMO_INVITE) {
          throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у колеги', 404, 'company_not_found');
        }
        if (inDemo) throw new ApiError('Ви вже в цій компанії', 409, 'same_company');
        // повертаємось у демо-компанію: її дані знову з початкових JSON
        ['company', 'trips', 'vehicles', 'drivers', 'clients', 'tasks', 'chat', 'roles'].forEach((k) => localStorage.removeItem(`nevpade.mock.${k}`));
        const user = { ...me, role: 'manager', companyId: seed.company.id, companyName: seed.company.name };
        save('mock.roles', { [me.id]: 'manager' });
        return { user, company: freshSeed(seed.company) };
      }
      // нова компанія: лише ви, керівник; усі розділи порожні
      const today = new Date().toISOString().slice(0, 10);
      const self = members.find((m) => m.id === me.id);
      const created = {
        id: `cmp_${Date.now().toString(36)}`,
        name: company.name,
        inviteCode: `NVP-${Math.floor(1000 + Math.random() * 9000)}`,
        city: null,
        createdAt: today,
        members: [{ ...self, role: 'owner', online: true }],
      };
      save('mock.company', created);
      ['trips', 'vehicles', 'drivers', 'clients', 'tasks', 'chat'].forEach((k) => save(`mock.${k}`, []));
      save('mock.roles', { [me.id]: 'owner' });
      return { user: { ...me, role: 'owner', companyId: created.id, companyName: created.name }, company: created };
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
    mock: () => ({ inviteCode: `NVP-${Math.floor(1000 + Math.random() * 9000)}` }),
  });

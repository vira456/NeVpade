// Компанія поточного менеджера та її учасники
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';
import seed from '../mock/company.json';

// У моках «я» — перший учасник; ім'я/фото беремо з профілю, назву — з реєстрації
function mockMembers() {
  const me = getCurrentUser();
  const profile = load('mock.profile');
  const roles = load('mock.roles') ?? {};
  return seed.members.map((m) => {
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
    mock: () => ({ ...seed.company, name: getCurrentUser()?.companyName || seed.company.name }),
  });

export const getMembers = () => request('/company/members', { mock: mockMembers });

// Новий код запрошення (старий перестає діяти)
export const regenerateInvite = () =>
  request('/company/invite', {
    method: 'POST',
    mock: () => ({ inviteCode: `NVP-${Math.floor(1000 + Math.random() * 9000)}` }),
  });

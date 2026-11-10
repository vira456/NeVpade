// Компанія поточного менеджера та її учасники
import { request } from './client.js';
import { getCurrentUser } from './auth.js';
import { load } from '../utils/storage.js';
import seed from '../mock/company.json';

// У моках «я» — перший учасник; ім'я/фото беремо з профілю, назву — з реєстрації
function mockMembers() {
  const me = getCurrentUser();
  const profile = load('mock.profile');
  return seed.members.map((m) =>
    m.id === (me?.id ?? 'usr_01')
      ? { ...m, name: profile?.fullName ?? me?.name ?? m.name, avatarUrl: profile?.avatarUrl ?? null, online: true }
      : m
  );
}

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

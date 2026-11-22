// Компанія, команда й заявки на вступ у режимі моків.
// Демо-компанія «Західтранс» з колегами й рейсами. mock.company — інша компанія (зі старих версій демо);
// зараз у моках є лише демо-компанія, тож перехід в іншу закінчується «Компанію не знайдено».
import { ApiError } from '../api/client.js';
import { getCurrentUser, roleOf } from '../api/auth.js';
import { load, save } from '../utils/storage.js';
import seed from './company.json';
import { freshSeed, mockTrips, saveTrips } from './store.js';
import { profileKey } from './profile.js';
import { joinRequests, saveJoinRequests, setManagerStatus, companyCode } from './auth.js';

const otherCompany = () => load('mock.company');
const meId = () => String(getCurrentUser()?.id ?? 'usr_01');

function assertOwner() {
  if (roleOf(getCurrentUser()) !== 'owner') throw new ApiError('Ця дія доступна лише власнику компанії', 403, 'owner_only');
}

// «Я» — з ім'ям і фото з профілю; + менеджери, яких власник прийняв за заявками на вступ
function members() {
  const me = getCurrentUser();
  const profile = load(profileKey(me?.id ?? 'usr_01'));
  const roles = load('mock.roles') ?? {};
  const removed = load('mock.removed') ?? [];
  const other = otherCompany();
  const list = [...(other ? other.members : freshSeed(seed.members)), ...(load('mock.joined') ?? [])].filter((m) => !removed.includes(m.id));
  return list.map((m) => {
    const member = { ...m, role: roles[m.id] ?? (m.id === me?.id && me?.role ? me.role : m.role) };
    return m.id === (me?.id ?? 'usr_01')
      ? { ...member, name: profile?.fullName ?? me?.name ?? m.name, avatarUrl: profile?.avatarUrl ?? null, online: true }
      : member;
  });
}

export function get() {
  const company = otherCompany() ?? { ...freshSeed(seed.company), name: getCurrentUser()?.companyName || seed.company.name, ...(load('mock.companyInfo') ?? {}) };
  // код компанії бачить лише власник
  if (roleOf(getCurrentUser()) !== 'owner') delete company.inviteCode;
  return company;
}

export const listMembers = () => members();

export function getMember(id) {
  const m = members().find((x) => x.id === id);
  if (!m) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
  return m;
}

export function switchCompany(company) {
  const me = getCurrentUser();
  if (roleOf(me) === 'owner') throw new ApiError('Власник не змінює компанію, а передає її менеджеру', 403, 'manager_only');
  const inDemo = !otherCompany();
  if (company.mode !== 'join') throw new ApiError('Нову компанію створює власник під час реєстрації', 400, 'join_only');
  if (company.code !== companyCode()) throw new ApiError('Компанію з таким кодом не знайдено. Перевірте код у власника', 404, 'company_not_found');
  if (inDemo) throw new ApiError('Ви вже в цій компанії', 409, 'same_company');
  // повертаємось у демо-компанію: її дані знову з початкових JSON
  ['company', 'companyInfo', 'removed', 'trips', 'vehicles', 'drivers', 'clients', 'tasks', 'chat', 'roles'].forEach((k) => localStorage.removeItem(`nevpade.mock.${k}`));
  // у новій компанії — заявка, доки власник не прийме
  const user = { ...me, role: 'manager', companyId: seed.company.id, companyName: seed.company.name, memberStatus: 'pending' };
  return { user, company: freshSeed(seed.company) };
}

export function regenerateInvite() {
  assertOwner(); // новий код компанії створює лише власник (з кабінету)
  const inviteCode = `NVP-${Math.floor(1000 + Math.random() * 9000)}`;
  save('mock.companyInfo', { ...(load('mock.companyInfo') ?? {}), inviteCode }); // з цим кодом менеджери тепер і входять
  return { inviteCode };
}

export function update(data) {
  assertOwner();
  const name = data.name?.trim();
  if (data.name !== undefined && name.length < 2) throw new ApiError('Вкажіть назву компанії', 422, 'invalid_name');
  const other = otherCompany();
  const current = other ?? { ...freshSeed(seed.company), ...(load('mock.companyInfo') ?? {}) };
  const updated = { ...current, ...(name && { name }), ...(data.city !== undefined && { city: data.city?.trim() || null }) };
  if (other) save('mock.company', updated);
  else save('mock.companyInfo', { ...(load('mock.companyInfo') ?? {}), name: updated.name, city: updated.city }); // код компанії не губимо
  return updated;
}

export function removeMember(memberId, transferTo) {
  const list = members();
  assertOwner();
  if (memberId === meId()) throw new ApiError('Себе прибрати не можна — спершу передайте компанію колезі', 409, 'cannot_remove_self');
  if (!list.some((m) => m.id === memberId && m.role !== 'owner')) throw new ApiError('Такого менеджера в компанії немає', 404, 'member_not_found');
  const trips = mockTrips();
  const active = trips.filter((t) => t.managerId === memberId && ['planned', 'in_progress'].includes(t.status));
  if (active.length && !transferTo) throw new ApiError('Оберіть менеджера, якому перейдуть активні рейси', 409, 'transfer_required');
  if (transferTo && !list.some((m) => m.id === transferTo && m.role !== 'owner' && m.id !== memberId)) {
    throw new ApiError('Рейси можна передати лише іншому менеджеру компанії', 422, 'invalid_transfer');
  }
  active.forEach((t) => {
    (t.history ??= []).push({ at: new Date().toISOString(), by: meId(), action: 'transferred', from: memberId, to: transferTo });
    t.managerId = transferTo;
  });
  saveTrips(trips);
  save('mock.removed', [...(load('mock.removed') ?? []), memberId]);
  const gone = list.find((m) => m.id === memberId);
  if (gone?.email) setManagerStatus(gone.email, 'removed');
  return { transferred: active.length };
}

// ---------- Заявки на вступ ----------
export function listJoinRequests() {
  assertOwner();
  return joinRequests().filter((r) => r.status === 'pending');
}

function decide(id, status) {
  assertOwner();
  const list = joinRequests();
  const req = list.find((r) => r.id === id && r.status === 'pending');
  if (!req) throw new ApiError('Заявку вже розглянуто або скасовано', 404, 'request_not_found');
  req.status = status;
  req.decidedAt = new Date().toISOString();
  saveJoinRequests(list);
  setManagerStatus(req.email, status === 'approved' ? 'active' : 'rejected');
  return req;
}

export function approveJoinRequest(id) {
  const req = decide(id, 'approved');
  const member = { id: req.userId, name: req.name, position: 'Менеджер з вантажоперевезень', email: req.email, phone: req.phone, online: false, lastSeen: null, role: 'manager' };
  save('mock.joined', [...(load('mock.joined') ?? []).filter((m) => m.id !== member.id), member]);
  save('mock.removed', (load('mock.removed') ?? []).filter((x) => x !== member.id));
  return member;
}

export function rejectJoinRequest(id) {
  decide(id, 'rejected');
  return { ok: true };
}

// Компанія поточного менеджера та її учасники. Відповіді в режимі моків — mock/company.js.
import { request, ApiError } from './client.js';
import { getCurrentUser } from './auth.js';

export const getCompany = () => request('/company', { mock: (m) => m.company.get() });

// Сервер на MongoDB може віддати _id замість id — вирівнюємо, щоб посилання на профілі працювали
const normalize = (m) => ({ ...m, id: String(m.id ?? m._id ?? m.userId ?? '') });
export const getMembers = () => request('/company/members', { mock: (m) => m.company.listMembers() }).then((list) => (list ?? []).map(normalize));

/**
 * Один колега — для сторінки «Профіль колеги».
 * Якщо на сервері ще немає GET /company/members/{id}, беремо людину зі списку /company/members.
 */
export async function getMember(id) {
  try {
    const one = await request(`/company/members/${id}`, { mock: (m) => m.company.getMember(id) });
    return normalize(one);
  } catch (err) {
    if (err.code === 'member_not_found' || err.status === 401) throw err;
    const m = (await getMembers()).find((x) => x.id === String(id));
    if (!m) throw new ApiError('Такого колеги в компанії немає', 404, 'member_not_found');
    return m;
  }
}

/**
 * Менеджер переходить в іншу компанію: { mode: 'join', code } — це заявка її власнику.
 * Доступ до старої компанії закривається одразу, до нової — після підтвердження (memberStatus: 'pending').
 * Виконані рейси лишаються в історії старої компанії. Відповідь — { user, company }.
 */
export const switchCompany = (company) =>
  request('/company/switch', {
    method: 'POST',
    body: { company },
    mock: (m) => m.company.switchCompany(company),
  }).then((res) => {
    localStorage.setItem('user', JSON.stringify(res.user));
    return res;
  });

/** Скільки активних рейсів у мене зараз (щоб попередити перед переходом) */
export const myActiveTrips = (trips, id = getCurrentUser()?.id) =>
  trips.filter((t) => t.managerId === id && ['planned', 'in_progress'].includes(t.status));

// Новий код компанії (старий перестає діяти)
export const regenerateInvite = () => request('/company/invite', { method: 'POST', mock: (m) => m.company.regenerateInvite() });

// ---------- Кабінет власника ----------
/** Змінити назву чи місто компанії (лише власник). data: { name?, city? } */
export const updateCompany = (data) =>
  request('/company', {
    method: 'PATCH',
    body: data,
    mock: (m) => m.company.update(data),
  }).then((company) => {
    const me = getCurrentUser();
    if (me && company?.name) localStorage.setItem('user', JSON.stringify({ ...me, companyName: company.name }));
    return company;
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
    mock: (m) => m.company.removeMember(memberId, transferTo),
  });

// ---------- Заявки на вступ ----------
/**
 * Менеджери, які зареєструвались з кодом компанії й чекають підтвердження (лише власник).
 * [{ id, userId, name, email, phone, createdAt, status: "pending" }]
 */
export const getJoinRequests = () => request('/company/join-requests', { mock: (m) => m.company.listJoinRequests() });

/** Прийняти менеджера: він одразу отримує доступ до робочого простору компанії. Відповідь — новий учасник */
export const approveJoinRequest = (id) => request(`/company/join-requests/${id}/approve`, { method: 'POST', mock: (m) => m.company.approveJoinRequest(id) });

/** Відхилити заявку: людина побачить це й зможе ввести інший код */
export const rejectJoinRequest = (id) => request(`/company/join-requests/${id}/reject`, { method: 'POST', mock: (m) => m.company.rejectJoinRequest(id) });

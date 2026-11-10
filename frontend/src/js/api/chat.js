// Спільний чат компанії.
// Сервер: GET /company/chat?after=<id> (опитування кожні кілька секунд) і POST /company/chat.
// Моки: повідомлення в localStorage, а BroadcastChannel миттєво показує їх в інших вкладках —
// так можна перевірити «живий» чат, відкривши сайт у двох вкладках.
import { request } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';
import seed from '../mock/chat.json';

const channel = 'BroadcastChannel' in window ? new BroadcastChannel('nevpade-chat') : null;
const mockMessages = () => load('mock.chat') ?? seed;

function persist(message) {
  save('mock.chat', [...mockMessages(), message]);
  channel?.postMessage(message);
  return message;
}

const newId = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

export const getMessages = (after = '') =>
  request(`/company/chat${after ? `?after=${after}` : ''}`, {
    mock: () => {
      const all = mockMessages();
      const i = after ? all.findIndex((m) => m.id === after) : -1;
      return all.slice(i + 1);
    },
  });

export const sendMessage = (text) =>
  request('/company/chat', {
    method: 'POST',
    body: { text },
    mock: () => persist({ id: newId(), authorId: getCurrentUser()?.id ?? 'usr_01', text, createdAt: new Date().toISOString() }),
  });

// Системне повідомлення про передачу рейсу (у реальному API його створює сервер у /trips/{id}/transfer)
export const mockTransferMessage = ({ tripId, toId, text }) =>
  persist({ id: newId(), type: 'transfer', authorId: getCurrentUser()?.id ?? 'usr_01', tripId, toId, text, createdAt: new Date().toISOString() });

// Підписка на нові повідомлення: callback(messages[])
export function subscribe(getLastId, callback, intervalMs = 4000) {
  if (channel) channel.onmessage = (e) => callback([e.data]);
  const timer = setInterval(async () => {
    try {
      const fresh = await getMessages(getLastId());
      if (fresh?.length) callback(fresh);
    } catch {
      /* мережа недоступна — спробуємо наступного разу */
    }
  }, intervalMs);
  return () => clearInterval(timer);
}

// ---------- Непрочитані ----------
export const getLastRead = () => load('chatLastRead', 'msg_004');
export function markRead(lastId) {
  save('chatLastRead', lastId);
  save('chatUnread', 0);
}

export async function countUnread() {
  const me = getCurrentUser()?.id ?? 'usr_01';
  const fresh = await getMessages(getLastRead());
  const n = (fresh ?? []).filter((m) => m.authorId !== me).length;
  save('chatUnread', n);
  return n;
}

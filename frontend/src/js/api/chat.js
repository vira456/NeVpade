// Спільний чат компанії.
// Сервер: GET /company/chat?after=<id> (опитування кожні кілька секунд) і POST /company/chat.
// Відповіді в режимі моків — mock/chat.js.
import { request, isMockMode } from './client.js';
import { getCurrentUser } from './auth.js';
import { load, save } from '../utils/storage.js';

// Лише моки: канал між вкладками (mock/chat.js шле в нього нові повідомлення)
export const chatChannel = isMockMode && 'BroadcastChannel' in window ? new BroadcastChannel('nevpade-chat') : null;

export const getMessages = (after = '') => request(`/company/chat${after ? `?after=${after}` : ''}`, { mock: (m) => m.chat.list(after) });

export const sendMessage = (text) => request('/company/chat', { method: 'POST', body: { text }, mock: (m) => m.chat.send(text) });

// Підписка на нові повідомлення: callback(messages[])
export function subscribe(getLastId, callback, intervalMs = 4000) {
  if (chatChannel) chatChannel.onmessage = (e) => callback([e.data]);
  const timer = setInterval(async () => {
    if (document.hidden) return; // вкладка у фоні — не смикаємо сервер
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

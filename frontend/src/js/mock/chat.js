// Чат компанії в режимі моків: повідомлення в localStorage, а BroadcastChannel (з api/chat.js)
// миттєво показує їх в інших вкладках — так можна перевірити «живий» чат у двох вкладках.
import { getCurrentUser } from '../api/auth.js';
import { chatChannel } from '../api/chat.js';
import { load, save } from '../utils/storage.js';
import seed from './chat.json';
import { freshSeed } from './store.js';

const all = () => load('mock.chat') ?? freshSeed(seed);
const newId = () => `msg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const me = () => getCurrentUser()?.id ?? 'usr_01';

function persist(message) {
  save('mock.chat', [...all(), message]);
  chatChannel?.postMessage(message);
  return message;
}

export function list(after) {
  const messages = all();
  const i = after ? messages.findIndex((m) => m.id === after) : -1;
  return messages.slice(i + 1);
}

export const send = (text) => persist({ id: newId(), authorId: me(), text, createdAt: new Date().toISOString() });

// Системне повідомлення про передачу рейсу (у реальному API його створює сервер у /trips/{id}/transfer)
export const transferMessage = ({ tripId, toId, text }) =>
  persist({ id: newId(), type: 'transfer', authorId: me(), tripId, toId, text, createdAt: new Date().toISOString() });

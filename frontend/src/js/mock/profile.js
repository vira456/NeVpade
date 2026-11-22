// Профіль у режимі моків: кожен демо-акаунт має свій профіль у localStorage
// (Віра, usr_01 — mock.profile, колеги — mock.profile.<id>)
import { ApiError } from '../api/client.js';
import { getCurrentUser } from '../api/auth.js';
import { load, save } from '../utils/storage.js';
import defaults from './profile.json';
import companySeed from './company.json';
import { MOCK_PASSWORD } from './auth.js';

export const profileKey = (id = getCurrentUser()?.id ?? 'usr_01') => (id === 'usr_01' ? 'mock.profile' : `mock.profile.${id}`);

function current() {
  const saved = load(profileKey());
  if (saved) return saved;
  const me = getCurrentUser();
  if (!me || me.id === 'usr_01') return { ...defaults.profile, language: load('lang', 'uk') };
  // колега з демо-компанії або менеджер, який щойно зареєструвався (тоді — з даних акаунта)
  const member = companySeed.members.find((m) => m.id === me.id) ?? { id: me.id, name: me.name, position: 'Менеджер з вантажоперевезень', email: me.email, phone: me.phone };
  return { id: member.id, fullName: member.name, position: member.position, email: member.email, phone: member.phone, language: load('lang', 'uk'), avatarUrl: null };
}

export const get = () => current();

export function update(data) {
  const updated = { ...current(), ...data };
  save(profileKey(), updated);
  return updated;
}

export function setAvatar(image) {
  const updated = { ...current(), avatarUrl: image };
  if (!save(profileKey(), updated)) throw new ApiError('Не вдалося зберегти фото: замало місця в сховищі браузера', 0);
  return updated;
}

export function changePassword(currentPassword, newPassword) {
  if (currentPassword !== (load('mock.password') ?? MOCK_PASSWORD)) throw new ApiError('Невірний поточний пароль', 400, 'invalid_password');
  save('mock.password', newPassword);
  return { message: 'Пароль змінено' };
}

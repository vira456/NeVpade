// Аватар учасника компанії: фото або ініціали + позначка «в мережі»
import { escapeHtml } from './format.js';
import { initials } from './layout.js';

export const avatar = (m, { size = 40, dot = true } = {}) => `
  <span class="person-avatar" style="--size:${size}px" data-no-i18n>
    ${m.avatarUrl ? `<img src="${escapeHtml(m.avatarUrl)}" alt="" />` : escapeHtml(initials(m.name))}
    ${dot ? `<i class="person-avatar__dot ${m.online ? 'is-online' : ''}" title="${m.online ? 'В мережі' : 'Не в мережі'}"></i>` : ''}
  </span>`;

// «Мельничук Олег Петрович» (ПІБ) → «Олег Мельничук»; «Олена Коваль» лишається як є
export function shortName(full = '') {
  const words = full.trim().split(/\s+/);
  return words.length === 3 ? `${words[1]} ${words[0]}` : full.trim();
}

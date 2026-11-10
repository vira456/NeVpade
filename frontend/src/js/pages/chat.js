// Спільний чат компанії: історія, нові повідомлення в реальному часі, повідомлення про передачу рейсів
import { renderLayout, setChatBadge } from '../utils/layout.js';
import { getMessages, sendMessage, subscribe, markRead } from '../api/chat.js';
import { getMembers, getCompany } from '../api/company.js';
import { getTrips, myId } from '../api/trips.js';
import { escapeHtml } from '../utils/format.js';
import { avatar, shortName } from '../utils/people.js';
import { icons } from '../utils/icons.js';
import { showToast } from '../utils/toast.js';
import { locale, t } from '../i18n/index.js';

renderLayout();

const list = document.getElementById('chatList');
const scroller = document.getElementById('chatScroll');
const form = document.getElementById('chatForm');
const input = document.getElementById('chatInput');

let members = [];
let trips = [];
let messages = [];

const person = (id) => members.find((m) => m.id === id) ?? { id, name: '—', online: false };
const timeOf = (iso) => new Date(iso).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(Date.now() - 864e5);
  if (d.toDateString() === today.toDateString()) return 'Сьогодні';
  if (d.toDateString() === yesterday.toDateString()) return 'Вчора';
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'long' });
}

// Посилання й переноси рядків у тексті повідомлення
const formatText = (text) =>
  escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
    .replace(/\n/g, '<br>');

function renderMessage(m, prev) {
  const mine = m.authorId === myId();
  const author = person(m.authorId);
  const day = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
  const grouped = !day && prev && prev.authorId === m.authorId && prev.type !== 'transfer' && m.type !== 'transfer' &&
    new Date(m.createdAt) - new Date(prev.createdAt) < 5 * 60e3;

  let html = day ? `<li class="chat__day"><span>${dayLabel(m.createdAt)}</span></li>` : '';

  if (m.type === 'transfer') {
    const trip = trips.find((x) => x.id === m.tripId);
    const to = person(m.toId);
    html += `
      <li class="chat__event">
        <div class="transfer-note">
          <span class="transfer-note__icon">${icons.transfer}</span>
          <div>
            <p class="transfer-note__title">${t('{from} передає рейс {trip} → {to}', {
              from: `<b data-no-i18n>${escapeHtml(shortName(author.name))}</b>`,
              trip: trip ? `<a href="/pages/trips.html?trip=${trip.id}&scope=all">${escapeHtml(trip.number)}</a>` : '',
              to: `<b data-no-i18n>${escapeHtml(shortName(to.name))}</b>`,
            })}</p>
            ${trip ? `<p class="transfer-note__route" data-no-i18n>${escapeHtml(trip.from.city)} → ${escapeHtml(trip.to.city)}</p>` : ''}
            ${m.text ? `<p class="transfer-note__comment" data-no-i18n>«${formatText(m.text)}»</p>` : ''}
          </div>
          <time datetime="${m.createdAt}">${timeOf(m.createdAt)}</time>
        </div>
      </li>`;
    return html;
  }

  html += `
    <li class="msg ${mine ? 'msg--mine' : ''} ${grouped ? 'msg--grouped' : ''}" data-id="${m.id}">
      ${mine || grouped ? '<span class="msg__spacer"></span>' : avatar(author, { size: 34, dot: false })}
      <div class="msg__body">
        ${mine || grouped ? '' : `<span class="msg__author" data-no-i18n>${escapeHtml(shortName(author.name))}</span>`}
        <div class="msg__bubble" data-no-i18n>${formatText(m.text)}</div>
        <time class="msg__time" datetime="${m.createdAt}">${timeOf(m.createdAt)}</time>
      </div>
    </li>`;
  return html;
}

function renderAll() {
  list.innerHTML = messages.length
    ? messages.map((m, i) => renderMessage(m, messages[i - 1])).join('')
    : '<li class="empty"><p class="empty__title">Тут поки тихо</p><p>Напишіть перше повідомлення колегам.</p></li>';
  scrollToEnd();
}

function append(fresh) {
  const known = new Set(messages.map((m) => m.id));
  const added = fresh.filter((m) => !known.has(m.id));
  if (!added.length) return;
  const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 120;
  added.forEach((m) => {
    list.querySelector('.empty')?.remove();
    list.insertAdjacentHTML('beforeend', renderMessage(m, messages[messages.length - 1]));
    messages.push(m);
  });
  if (nearBottom || added.some((m) => m.authorId === myId())) scrollToEnd();
  markRead(messages[messages.length - 1].id);
  setChatBadge(0);
}

const scrollToEnd = () => (scroller.scrollTop = scroller.scrollHeight);

function renderPeople() {
  document.getElementById('chatPeople').innerHTML = [...members]
    .sort((a, b) => b.online - a.online)
    .map(
      (m) => `<li class="chat-people__item">${avatar(m, { size: 34 })}
        <span><strong data-no-i18n>${escapeHtml(shortName(m.name))}</strong><small>${escapeHtml(m.position)}</small></span></li>`
    )
    .join('');
  const online = members.filter((m) => m.online).length;
  document.getElementById('chatLive').lastChild.textContent = t('{n} онлайн', { n: online });
}

// ---------- Надсилання ----------
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

input.addEventListener('input', autosize);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    form.requestSubmit();
  }
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  autosize();
  try {
    append([await sendMessage(text)]);
  } catch (err) {
    input.value = text; // не губимо текст, якщо не вдалося надіслати
    showToast(t('Не вдалося надіслати: {e}', { e: err.message }), 'error');
  }
  input.focus();
});

async function init() {
  form.querySelector('.chat__send').innerHTML = icons.send;
  const [m, company, tr, history] = await Promise.all([getMembers(), getCompany(), getTrips(), getMessages()]);
  members = m;
  trips = tr;
  messages = history;
  document.getElementById('chatSub').textContent = t('{company} · {n} учасників', { company: company.name, n: members.length });
  renderPeople();
  renderAll();
  if (messages.length) markRead(messages[messages.length - 1].id);
  setChatBadge(0);
  subscribe(() => messages[messages.length - 1]?.id ?? '', append);
  input.focus();
}

init();

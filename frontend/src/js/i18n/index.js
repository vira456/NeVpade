// ============================================================
// Переклад інтерфейсу UA → EN.
// Ключ словника — сам український текст (як у gettext), тож розмітку
// й код не треба засмічувати ключами: модуль після завантаження й при
// кожній зміні DOM замінює відомі українські рядки англійськими.
// Рядки зі змінними частинами описано шаблонами: '{n} рейсів' → '{n} trips'.
// Словник (en.js) вантажиться окремим файлом і лише для англійської мови.
// ============================================================
import { getLang } from '../utils/prefs.js';

export const lang = getLang();
export const isEnglish = lang === 'en';
export const locale = () => (isEnglish ? 'en-GB' : 'uk-UA');

const CYRILLIC = /[А-Яа-яІіЇїЄєҐґ]/;
const ATTRS = ['placeholder', 'title', 'aria-label', 'data-empty', 'alt'];

let exact = new Map();
let patterns = [];

// '{n} рейсів · {m} в дорозі' → /^(.+?) рейсів · (.+?) в дорозі$/
// {#n} — лише число (щоб «{#a} з {#b}» не спрацьовувало всередині звичайних речень)
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NUMBER = '([\\d\\s.,\\u00a0\\u202f–-]+?)';
const compile = (list) =>
  list
    .map(([src, dst]) => {
      const names = [];
      const source = escape(src).replace(/\\\{(#?)(\w+)\\\}/g, (_, num, name) => {
        names.push(name);
        return num ? NUMBER : '([\\s\\S]+?)';
      });
      // точніші шаблони (більше сталого тексту) перевіряємо першими
      const weight = src.replace(/\{#?\w+\}/g, '').length;
      return { re: new RegExp(`^${source}$`), names, dst: dst.replace(/\{#(\w+)\}/g, '{$1}'), weight };
    })
    .sort((a, b) => b.weight - a.weight);

const missing = new Set();

// Значення всередині шаблону: окреме слово, фраза або список через кому
function translateValue(value) {
  const v = value.trim();
  if (!CYRILLIC.test(v)) return value;
  if (exact.has(v)) return exact.get(v);
  if (v.includes(', ')) return v.split(', ').map((x) => exact.get(x) ?? x).join(', ');
  return translateText(v, { silent: true }) ?? value;
}
if (isEnglish) window.__i18nMissing = missing; // для перевірки: які рядки ще без перекладу

function translateText(text, { silent = false } = {}) {
  const key = text.trim();
  if (!key || !CYRILLIC.test(key)) return null;
  if (exact.has(key)) return exact.get(key);
  for (const p of patterns) {
    const m = key.match(p.re);
    if (!m) continue;
    let out = p.dst;
    p.names.forEach((name, i) => {
      out = out.replace(`{${name}}`, translateValue(m[i + 1]));
    });
    return out;
  }
  if (!silent) missing.add(key);
  return null;
}

/** Переклад рядка в коді (для canvas, document.title тощо). Параметри: t('{n} рейсів', { n: 5 }) */
export function t(text, params = {}) {
  let out = isEnglish ? translateText(text) ?? text : text;
  Object.entries(params).forEach(([k, v]) => (out = out.replaceAll(`{${k}}`, v)));
  return out;
}

function translateNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (node.parentElement?.closest('[data-no-i18n], textarea')) return;
    const tr = translateText(node.nodeValue);
    if (tr === null) return;
    const next = node.nodeValue.replace(node.nodeValue.trim(), tr);
    if (next !== node.nodeValue) node.nodeValue = next; // інакше MutationObserver зациклиться
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
  if (node.closest?.('[data-no-i18n]')) return; // дані користувача (чат, назви) не перекладаємо
  ATTRS.forEach((attr) => {
    const value = node.getAttribute(attr);
    const tr = value && translateText(value);
    if (tr && tr !== value) node.setAttribute(attr, tr);
  });
  // value кнопок <input type="button"> не використовуємо, тож лише дочірні вузли
  node.childNodes.forEach(translateNode);
}

function start() {
  const run = () => {
    translateNode(document.body);
    const title = translateText(document.title);
    if (title) document.title = title;
    document.documentElement.classList.remove('i18n-pending');
  };
  if (document.body) run();
  else document.addEventListener('DOMContentLoaded', run);

  new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      if (m.type === 'characterData') translateNode(m.target);
      else if (m.type === 'attributes') translateNode(m.target);
      else m.addedNodes.forEach(translateNode);
    });
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ATTRS,
  });
}

/** Проміс, що виконується, коли словник готовий (важливо для тексту на canvas, напр. графіків). */
export const i18nReady = isEnglish
  ? import('./en.js')
      .then(({ default: dictionary }) => {
        exact = new Map(Object.entries(dictionary.exact));
        patterns = compile(dictionary.patterns);
        start();
      })
      .catch(() => document.documentElement.classList.remove('i18n-pending')) // без перекладу, але сторінка видима
  : Promise.resolve();

if (isEnglish) document.documentElement.lang = 'en';

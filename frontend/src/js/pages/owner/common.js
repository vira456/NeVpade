// Спільне для сторінок кабінету власника: шапка компанії, перемикач періоду, формат чисел,
// показ нового коду власника (один раз)
import { getCompany } from '../../api/company.js';
import { takeOwnerCodeOnce } from '../../api/auth.js';
import { money, compactMoney, escapeHtml } from '../../utils/format.js';
import { icons } from '../../utils/icons.js';
import { copyText } from '../../utils/viber.js';
import { showToast } from '../../utils/toast.js';
import { locale, t } from '../../i18n/index.js';

export const $ = (id) => document.getElementById(id);

/** Зміна у відсотках до попереднього періоду (той самий відрізок) */
export function delta(current, previous) {
  if (!previous || current == null) return '';
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const up = pct >= 0;
  return `<span class="ledger__delta ${up ? 'is-good' : 'is-bad'}">${up ? icons.arrowUp : icons.arrowDown}${Math.abs(pct).toLocaleString(locale(), { maximumFractionDigits: 1 })} %</span>`;
}

/** Великі суми — стисло (1,2 млн грн), точне значення в підказці */
export const big = (n) => (Math.abs(n ?? 0) >= 1e6 ? `<span title="${money(n)}">${compactMoney(n)} грн</span>` : money(n ?? 0));

export const PERIOD_LABEL = { month: 'цього місяця', year: 'цього року' };

/** Кнопки «Місяць / Рік» — викликає onChange(period) */
export function bindPeriod(groupId, onChange) {
  const group = $(groupId);
  let period = 'month';
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-period]');
    if (!btn || btn.dataset.period === period) return;
    period = btn.dataset.period;
    group.querySelectorAll('[data-period]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    onChange(period);
  });
  return () => period;
}

/** Підзаголовок сторінки: «ТОВ «Західтранс» · Хмельницький · у системі з …» */
export async function renderCompanyLine(elId = 'ownerSubtitle') {
  let company = null;
  try {
    company = await getCompany();
  } catch {
    /* без компанії — лише порожній рядок */
  }
  const since = company?.createdAt ? new Date(company.createdAt).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const el = $(elId);
  if (el) el.textContent = [company?.name, company?.city, since && t('у системі з {date}', { date: since })].filter(Boolean).join(' · ');
  return company;
}

/**
 * Новий код власника показуємо один раз — після реєстрації чи перевипуску.
 * Вікно не закривається, доки власник не підтвердить, що зберіг код.
 */
export function showOwnerCode(code = takeOwnerCodeOnce()) {
  if (!code) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'modal owner-code-modal';
  dialog.setAttribute('aria-labelledby', 'ownerCodeTitle');
  dialog.innerHTML = `
    <form class="modal__body" method="dialog">
      <span class="owner-code-modal__icon">${icons.key}</span>
      <h2 class="modal__title" id="ownerCodeTitle">${t('Ваш код власника')}</h2>
      <p class="modal__text">${t('Без нього не увійти в кабінет власника — навіть з правильним паролем. Збережіть код у надійному місці: ми показуємо його лише один раз.')}</p>
      <div class="owner-code-modal__code">
        <strong data-no-i18n>${escapeHtml(code)}</strong>
        <button class="icon-btn" type="button" data-copy title="${t('Скопіювати код')}" aria-label="${t('Скопіювати код')}">${icons.copy}</button>
      </div>
      <label class="field field--check">
        <input type="checkbox" data-saved />
        <span>${t('Я зберіг(ла) код власника')}</span>
      </label>
      <div class="modal__actions">
        <span class="modal__spacer"></span>
        <button class="btn" type="submit" data-done disabled>${t('Готово')}</button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('cancel', (e) => e.preventDefault()); // Esc не закриває
  dialog.querySelector('[data-saved]').addEventListener('change', (e) => (dialog.querySelector('[data-done]').disabled = !e.target.checked));
  dialog.querySelector('[data-copy]').addEventListener('click', async () => {
    try {
      await copyText(code);
      showToast('Код скопійовано');
    } catch {
      showToast('Не вдалося скопіювати', 'error');
    }
  });
  dialog.addEventListener('close', () => dialog.remove());
  dialog.showModal();
}

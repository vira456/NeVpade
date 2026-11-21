// Спільне для сторінок кабінету власника: шапка компанії, перемикач періоду, формат чисел
import { getCompany } from '../../api/company.js';
import { money, compactMoney } from '../../utils/format.js';
import { icons } from '../../utils/icons.js';
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

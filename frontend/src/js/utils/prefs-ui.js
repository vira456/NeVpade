// Перемикачі теми та мови для сторінок без бокової панелі (вхід, реєстрація, лендинг)
import { withThemeReveal } from './motion.js';
import { icons } from './icons.js';
import { getTheme, setTheme, getLang, setLang } from './prefs.js';

export function renderPrefs(container, { theme = true, lang = true } = {}) {
  if (!container) return;
  const th = getTheme();
  const lg = getLang();
  container.innerHTML = `
    ${
      theme
        ? `<div class="pref" role="group" aria-label="Тема">
        <button type="button" data-theme-set="light" aria-pressed="${th === 'light'}" title="Світла тема" aria-label="Світла тема">${icons.sun}</button>
        <button type="button" data-theme-set="dark" aria-pressed="${th === 'dark'}" title="Темна тема" aria-label="Темна тема">${icons.moon}</button>
        <button type="button" data-theme-set="system" aria-pressed="${th === 'system'}" title="Як у системі" aria-label="Як у системі">${icons.monitor}</button>
      </div>`
        : ''
    }
    ${
      lang
        ? `<div class="pref" role="group" aria-label="Мова" data-no-i18n>
        <button type="button" data-lang-set="uk" aria-pressed="${lg === 'uk'}" title="Українська">UA</button>
        <button type="button" data-lang-set="en" aria-pressed="${lg === 'en'}" title="English">EN</button>
      </div>`
        : ''
    }`;

  container.querySelectorAll('[data-theme-set]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      withThemeReveal(e, () => setTheme(btn.dataset.themeSet));
      container.querySelectorAll('[data-theme-set]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    })
  );
  container.querySelectorAll('[data-lang-set]').forEach((btn) =>
    btn.addEventListener('click', () => btn.dataset.langSet !== lg && setLang(btn.dataset.langSet))
  );
}

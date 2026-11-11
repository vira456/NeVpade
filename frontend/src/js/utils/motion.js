// Невеликі анімації інтерфейсу. Усі вимикаються, якщо в системі ввімкнено «зменшити рух».
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * «Набігання» числа: 0 → 412 000 грн. Береться перше число в тексті елемента,
 * решта тексту (одиниці, «млн», «%») лишається як є.
 */
export function countUp(el, { duration = 900 } = {}) {
  if (reducedMotion() || el.dataset.counting) return;
  const html = el.innerHTML;
  const text = el.textContent;
  const en = document.documentElement.lang === 'en';
  // uk: «412 000», «4,19»; en: «412,000», «4.19»
  const match = text.match(en ? /\d[\d,]*(\.\d+)?/ : /\d[\d\s\u00a0\u202f]*(,\d+)?/);
  if (!match) return;
  const raw = match[0].trim();
  const decimals = match[1] ? match[1].length - 1 : 0;
  const target = parseFloat(en ? raw.replace(/,/g, '') : raw.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  if (!Number.isFinite(target) || target === 0) return;
  const fmt = new Intl.NumberFormat(en ? 'en-GB' : 'uk-UA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

  const start = performance.now();
  const ease = (t) => 1 - Math.pow(1 - t, 3);
  el.dataset.counting = '1';
  const frame = (now) => {
    const p = Math.min(1, (now - start) / duration);
    if (p < 1) {
      el.textContent = text.replace(raw, fmt.format(target * ease(p)));
      requestAnimationFrame(frame);
    } else {
      el.innerHTML = html; // повертаємо точну розмітку (підказки, <small> тощо)
      delete el.dataset.counting;
    }
  };
  requestAnimationFrame(frame);
}

export const countUpAll = (root, selector) => root.querySelectorAll(selector).forEach((el) => countUp(el));

/**
 * Зміна теми з «колом», що розходиться від кнопки (View Transitions API — Chrome, Edge).
 * В інших браузерах тема просто змінюється.
 */
export function withThemeReveal(event, apply) {
  if (!document.startViewTransition || reducedMotion()) return apply();
  const x = event?.clientX ?? innerWidth / 2;
  const y = event?.clientY ?? innerHeight / 2;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = document.startViewTransition(apply);
  transition.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 550, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' }
    );
  });
}

// Елемент «від'їжджає» праворуч і зникає (передача рейсу колезі)
export function driveAway(el) {
  if (!el || reducedMotion()) return Promise.resolve();
  return el
    .animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: 'translateX(-12px)', opacity: 1, offset: 0.2 },
        { transform: 'translateX(110%)', opacity: 0 },
      ],
      { duration: 650, easing: 'cubic-bezier(.5, 0, .75, 0)' }
    )
    .finished.catch(() => {});
}

// Іконка літачка «відлітає» з кнопки
export function flyAway(button) {
  const icon = button?.querySelector('svg');
  if (!icon || reducedMotion()) return;
  icon.animate(
    [
      { transform: 'translate(0, 0) rotate(0)', opacity: 1 },
      { transform: 'translate(22px, -18px) rotate(-12deg)', opacity: 0, offset: 0.55 },
      { transform: 'translate(-14px, 10px)', opacity: 0, offset: 0.56 },
      { transform: 'translate(0, 0)', opacity: 1 },
    ],
    { duration: 800, easing: 'ease-in-out' }
  );
}

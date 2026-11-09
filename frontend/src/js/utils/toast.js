// Спливаючі сповіщення (toast) у правому нижньому куті
let container;

function getContainer() {
  if (!container) {
    container = document.createElement('div');
    container.className = 'toasts';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

/**
 * @param {string} message
 * @param {'success'|'error'|'info'} type
 * @param {number} timeout мс до автоматичного закриття
 */
export function showToast(message, type = 'success', timeout = 3500) {
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.innerHTML = `<span class="toast__icon" aria-hidden="true"></span><span class="toast__text"></span><button class="toast__close" type="button" aria-label="Закрити">×</button>`;
  toast.querySelector('.toast__text').textContent = message;

  const close = () => {
    toast.classList.add('is-leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.toast__close').addEventListener('click', close);

  getContainer().appendChild(toast);
  if (timeout) setTimeout(close, timeout);
}

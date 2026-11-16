// Діалог підтвердження замість браузерного confirm()
let dialog;

function build() {
  dialog = document.createElement('dialog');
  dialog.className = 'modal modal--confirm';
  dialog.innerHTML = `
    <form method="dialog" class="modal__body">
      <h2 class="modal__title"></h2>
      <p class="modal__text"></p>
      <div class="modal__actions">
        <button class="btn btn--text" value="cancel">Скасувати</button>
        <button class="btn btn--danger-solid" value="ok"></button>
      </div>
    </form>`;
  document.body.appendChild(dialog);
}

/**
 * @returns {Promise<boolean>} true — користувач підтвердив
 */
export function confirmDialog({ title, text = '', confirmText = 'Видалити' }) {
  if (!dialog) build();
  dialog.querySelector('.modal__title').textContent = title;
  dialog.querySelector('.modal__text').textContent = text;
  dialog.querySelector('[value=ok]').textContent = confirmText;
  dialog.returnValue = '';
  dialog.showModal();
  dialog.querySelector('[value=cancel]').focus();

  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  });
}

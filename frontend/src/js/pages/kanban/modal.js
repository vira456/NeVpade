// Модальне вікно створення / редагування завдання (<dialog>)
import { escapeHtml } from '../../utils/format.js';
import { setFieldError, clearErrors } from '../../utils/validation.js';
import { COLUMNS, PRIORITIES, todayIso } from './config.js';

const dialog = document.getElementById('taskDialog');
const form = document.getElementById('taskForm');
const { title, description, status, dueDate, tripId } = form.elements;
const heading = document.getElementById('taskDialogTitle');
const deleteBtn = document.getElementById('taskDelete');
const descCounter = document.getElementById('taskDescCounter');

const MAX_TITLE = 120;
const MAX_DESC = 1000;

let current = null; // завдання, що редагується (null — нове)
let handlers = {};

export function initModal({ trips, onSave, onDelete }) {
  handlers = { onSave, onDelete };

  status.innerHTML = COLUMNS.map((c) => `<option value="${c.status}">${c.title}</option>`).join('');
  tripId.innerHTML =
    '<option value="">Без рейсу</option>' +
    trips
      .map((t) => `<option value="${t.id}">${escapeHtml(t.number)} · ${escapeHtml(t.from.city)} → ${escapeHtml(t.to.city)}</option>`)
      .join('');
  document.getElementById('taskPriority').innerHTML = Object.entries(PRIORITIES)
    .map(
      ([key, p]) => `
      <label class="segmented__item segmented__item--${key}">
        <input type="radio" name="priority" value="${key}" />
        <span>${p.label}</span>
      </label>`
    )
    .join('');

  description.addEventListener('input', updateCounter);
  title.addEventListener('input', () => setFieldError(title, ''));

  form.addEventListener('submit', submit);
  document.getElementById('taskCancel').addEventListener('click', () => dialog.close());
  deleteBtn.addEventListener('click', async () => {
    if (await handlers.onDelete(current)) dialog.close();
  });

  // Клік по затемненню закриває вікно
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}

function updateCounter() {
  descCounter.textContent = `${description.value.length} / ${MAX_DESC}`;
  descCounter.classList.toggle('is-over', description.value.length > MAX_DESC);
}

/**
 * @param {object|null} task — null для нового завдання
 * @param {{ status?: string }} defaults — колонка, з якої натиснули «+»
 */
export function openModal(task = null, defaults = {}) {
  current = task;
  clearErrors(form);
  heading.textContent = task ? 'Редагування завдання' : 'Нове завдання';
  deleteBtn.hidden = !task;

  title.value = task?.title ?? '';
  description.value = task?.description ?? '';
  status.value = task?.status ?? defaults.status ?? 'todo';
  form.elements.priority.value = task?.priority ?? 'medium';
  dueDate.value = task?.dueDate ?? '';
  dueDate.min = task ? '' : todayIso(); // для нових — не раніше сьогодні
  tripId.value = task?.tripId ?? '';
  form.querySelector('[type=submit]').textContent = task ? 'Зберегти' : 'Створити';
  updateCounter();

  dialog.showModal();
  title.focus();
}

function validate() {
  clearErrors(form);
  const errors = [];
  const t = title.value.trim();
  if (t.length < 3) errors.push([title, 'Назва має містити щонайменше 3 символи']);
  else if (t.length > MAX_TITLE) errors.push([title, `Максимум ${MAX_TITLE} символів`]);
  if (description.value.length > MAX_DESC) errors.push([description, `Опис задовгий: максимум ${MAX_DESC} символів`]);
  // Нове завдання не можна створити з терміном у минулому
  if (!current && dueDate.value && dueDate.value < todayIso()) errors.push([dueDate, 'Термін не може бути в минулому']);

  errors.forEach(([input, msg]) => setFieldError(input, msg));
  errors[0]?.[0].focus();
  return !errors.length;
}

async function submit(e) {
  e.preventDefault();
  if (!validate()) return;

  const data = {
    title: title.value.trim(),
    description: description.value.trim(),
    status: status.value,
    priority: form.elements.priority.value,
    dueDate: dueDate.value || null,
    tripId: tripId.value || null,
  };

  const btn = form.querySelector('[type=submit]');
  btn.disabled = true;
  try {
    if (await handlers.onSave(current, data)) dialog.close();
  } finally {
    btn.disabled = false;
  }
}

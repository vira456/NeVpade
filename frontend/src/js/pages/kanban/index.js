// Kanban-дошка завдань: «Маю зробити» → «В процесі» → «Зроблено»
import Sortable from 'sortablejs';
import { renderLayout } from '../../utils/layout.js';
import { getTasks, createTask, updateTask, deleteTask, reorderTasks } from '../../api/tasks.js';
import { getTrips } from '../../api/trips.js';
import { showToast } from '../../utils/toast.js';
import { confirmDialog } from '../../utils/confirm.js';
import { COLUMNS, PRIORITIES, isOverdue } from './config.js';
import { renderCard } from './card.js';
import { initModal, openModal } from './modal.js';
import { debounce } from '../../utils/debounce.js';

renderLayout();

const board = document.getElementById('board');
const search = document.getElementById('taskSearch');
const priorityFilter = document.getElementById('taskPriorityFilter');
const summary = document.getElementById('boardSummary');
const filterHint = document.getElementById('filterHint');

let tasks = [];
let trips = [];
const sortables = [];
let lastDropAt = 0; // щоб клік одразу після перетягування не відкривав картку

const tripOf = (task) => trips.find((t) => t.id === task.tripId);
const isFiltering = () => Boolean(search.value.trim() || priorityFilter.value);

function matches(task) {
  const q = search.value.trim().toLowerCase();
  const trip = tripOf(task);
  const text = `${task.title} ${task.description} ${trip?.number ?? ''}`.toLowerCase();
  return (!q || text.includes(q)) && (!priorityFilter.value || task.priority === priorityFilter.value);
}

// ---------- Відображення ----------
function renderBoard() {
  COLUMNS.forEach(({ status }) => {
    const column = tasks.filter((t) => t.status === status).sort((a, b) => a.order - b.order);
    const visible = column.filter(matches);
    const list = board.querySelector(`[data-status="${status}"] .column__list`);

    list.innerHTML = visible.map((t) => renderCard(t, tripOf(t))).join('');
    list.dataset.empty = isFiltering() ? 'Нічого не знайдено' : 'Перетягніть завдання сюди';
    board.querySelector(`[data-status="${status}"] .column__count`).textContent = isFiltering()
      ? `${visible.length} з ${column.length}`
      : column.length;
  });

  // Поки діє фільтр, перетягування вимкнене: інакше порядок прихованих карток зіб'ється
  const filtering = isFiltering();
  sortables.forEach((s) => s.option('disabled', filtering));
  filterHint.hidden = !filtering;

  const overdue = tasks.filter(isOverdue).length;
  const active = tasks.filter((t) => t.status !== 'done').length;
  summary.innerHTML = `Активних: <b>${active}</b> · Виконано: <b>${tasks.length - active}</b>${
    overdue ? ` · <span class="board-summary__overdue">Прострочено: <b>${overdue}</b></span>` : ''
  }`;
}

// ---------- Перетягування ----------
function initDragAndDrop() {
  board.querySelectorAll('.column__list').forEach((list) => {
    sortables.push(
      new Sortable(list, {
        group: 'tasks',
        animation: 160,
        filter: '.task__trip', // посилання на рейс не починає перетягування
        preventOnFilter: false,
        ghostClass: 'task--ghost',
        chosenClass: 'task--chosen',
        dragClass: 'task--drag',
        onStart: () => board.classList.add('is-dragging'),
        onEnd: handleDrop,
      })
    );
  });
}

async function handleDrop(evt) {
  board.classList.remove('is-dragging');
  lastDropAt = Date.now();
  if (evt.from === evt.to && evt.oldIndex === evt.newIndex) return;

  const before = structuredClone(tasks);
  const changed = [];

  // Новий порядок і статус для обох задіяних колонок — так, як вони стоять у DOM
  new Set([evt.from, evt.to]).forEach((list) => {
    const status = list.closest('.column').dataset.status;
    [...list.children].forEach((el, order) => {
      const task = tasks.find((t) => t.id === el.dataset.id);
      if (task && (task.status !== status || task.order !== order)) {
        Object.assign(task, { status, order });
        changed.push({ id: task.id, status, order });
      }
    });
  });

  renderBoard();
  if (!changed.length) return;

  const moved = tasks.find((t) => t.id === evt.item.dataset.id);
  if (evt.from !== evt.to && moved) {
    const column = COLUMNS.find((c) => c.status === moved.status).title;
    showToast(moved.status === 'done' ? `Виконано: «${moved.title}»` : `Перенесено в «${column}»`, 'success', 2500);
  }

  try {
    await reorderTasks(changed);
  } catch (err) {
    tasks = before; // сервер не прийняв — повертаємо як було
    renderBoard();
    showToast(`Не вдалося зберегти: ${err.message}`, 'error');
  }
}

// ---------- Створення / редагування / видалення ----------
async function saveTask(existing, data) {
  try {
    if (existing) {
      const statusChanged = existing.status !== data.status;
      const order = statusChanged ? tasks.filter((t) => t.status === data.status).length : existing.order;
      const updated = await updateTask(existing.id, { ...data, order });
      tasks = tasks.map((t) => (t.id === updated.id ? updated : t));
      showToast('Завдання оновлено');
    } else {
      // Нове завдання — на початок колонки
      const shifted = tasks.filter((t) => t.status === data.status).map((t) => ({ id: t.id, status: t.status, order: t.order + 1 }));
      const [created] = await Promise.all([createTask({ ...data, order: 0 }), shifted.length && reorderTasks(shifted)]);
      shifted.forEach((s) => (tasks.find((t) => t.id === s.id).order = s.order));
      tasks.push(created);
      showToast('Завдання створено');
    }
    renderBoard();
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

async function removeTask(task) {
  const ok = await confirmDialog({
    title: 'Видалити завдання?',
    text: `«${task.title}» буде видалено без можливості відновлення.`,
  });
  if (!ok) return false;
  try {
    await deleteTask(task.id);
    tasks = tasks.filter((t) => t.id !== task.id);
    renderBoard();
    showToast('Завдання видалено', 'info');
    return true;
  } catch (err) {
    showToast(err.message, 'error');
    return false;
  }
}

// ---------- Події ----------
board.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]');
  if (add) return openModal(null, { status: add.dataset.add });

  if (e.target.closest('.task__trip')) return; // перехід на карту
  if (Date.now() - lastDropAt < 300) return;
  const card = e.target.closest('.task');
  if (card) openModal(tasks.find((t) => t.id === card.dataset.id));
});

document.getElementById('newTaskBtn').addEventListener('click', () => openModal());
search.addEventListener('input', debounce(renderBoard));
priorityFilter.addEventListener('change', renderBoard);
document.getElementById('clearFilters').addEventListener('click', () => {
  search.value = '';
  priorityFilter.value = '';
  renderBoard();
});

// Гаряча клавіша «N» — нове завдання
document.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, textarea, select, dialog[open]')) return;
  e.preventDefault();
  openModal();
});

// ---------- Старт ----------
async function init() {
  board.innerHTML = COLUMNS.map(
    (c) => `
    <section class="column column--${c.status}" data-status="${c.status}" aria-labelledby="col-${c.status}">
      <header class="column__head">
        <span class="column__dot" aria-hidden="true"></span>
        <h2 class="column__title" id="col-${c.status}">${c.title}</h2>
        <span class="column__count">0</span>
        <button class="column__add" type="button" data-add="${c.status}" aria-label="Додати завдання в «${c.title}»">+</button>
      </header>
      <ul class="column__list"></ul>
    </section>`
  ).join('');

  priorityFilter.innerHTML =
    '<option value="">Усі пріоритети</option>' +
    Object.entries(PRIORITIES)
      .map(([k, p]) => `<option value="${k}">${p.label}</option>`)
      .join('');

  initDragAndDrop();

  try {
    [tasks, trips] = await Promise.all([getTasks(), getTrips()]);
  } catch (err) {
    showToast(`Не вдалося завантажити завдання: ${err.message}`, 'error', 0);
  }
  initModal({ trips, onSave: saveTask, onDelete: removeTask });
  renderBoard();
  board.classList.remove('is-loading');
}

init();

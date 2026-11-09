import Sortable from 'sortablejs';
import { renderLayout } from '../utils/layout.js';
import { getTasks, updateTaskStatus } from '../api/tasks.js';

renderLayout();

const COLUMNS = ['todo', 'in_progress', 'done'];

async function init() {
  const tasks = await getTasks();

  COLUMNS.forEach((status) => {
    const list = document.getElementById(status);
    list.innerHTML = tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.order - b.order)
      .map((t) => `<div class="kanban__item" data-id="${t.id}"><strong>${t.title}</strong><br><small>до ${t.dueDate}</small></div>`)
      .join('');

    new Sortable(list, {
      group: 'kanban',
      animation: 150,
      onAdd: (e) => updateTaskStatus(e.item.dataset.id, status, e.newIndex),
    });
  });
}

init();

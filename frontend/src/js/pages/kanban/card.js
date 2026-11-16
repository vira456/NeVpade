// HTML однієї картки завдання
import { escapeHtml } from '../../utils/format.js';
import { PRIORITIES, dueLabel } from './config.js';

export function renderCard(task, trip) {
  const due = dueLabel(task);
  const done = task.status === 'done';

  return `
    <li class="task task--${task.priority} ${done ? 'is-done' : ''}" data-id="${task.id}">
      <div class="task__top">
        <span class="priority priority--${task.priority}">${PRIORITIES[task.priority].label}</span>
        ${done ? '<span class="task__check" aria-label="Виконано">✓</span>' : ''}
      </div>
      <button class="task__open" type="button" aria-label="Відкрити завдання: ${escapeHtml(task.title)}">
        ${escapeHtml(task.title)}
      </button>
      ${task.description ? `<p class="task__desc">${escapeHtml(task.description)}</p>` : ''}
      ${
        due || trip
          ? `<div class="task__meta">
              ${due ? `<span class="due due--${due.tone}">${escapeHtml(due.text)}</span>` : ''}
              ${trip ? `<a class="task__trip" href="/pages/map.html?trip=${trip.id}" title="${escapeHtml(trip.from.city)} → ${escapeHtml(trip.to.city)}">${escapeHtml(trip.number)}</a>` : ''}
            </div>`
          : ''
      }
    </li>`;
}

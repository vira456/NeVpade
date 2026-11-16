// Завдання Kanban. У режимі моків зберігаються в localStorage.
import { request, ApiError } from './client.js';
import { load, save } from '../utils/storage.js';
import seed from '../mock/tasks.json';
import { freshSeed } from './mock-store.js'; // скидання старих демо-даних

const mockTasks = () => load('mock.tasks') ?? freshSeed(seed);
const persist = (tasks) => save('mock.tasks', tasks);

function findOrFail(tasks, id) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0) throw new ApiError('Завдання не знайдено', 404);
  return i;
}

export const getTasks = () => request('/tasks', { mock: mockTasks });

export const createTask = (data) =>
  request('/tasks', {
    method: 'POST',
    body: data,
    mock: () => {
      const tasks = mockTasks();
      const task = { ...data, id: `tsk_${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
      persist([...tasks, task]);
      return task;
    },
  });

export const updateTask = (id, data) =>
  request(`/tasks/${id}`, {
    method: 'PUT',
    body: data,
    mock: () => {
      const tasks = mockTasks();
      const i = findOrFail(tasks, id);
      tasks[i] = { ...tasks[i], ...data, id };
      persist(tasks);
      return tasks[i];
    },
  });

export const deleteTask = (id) =>
  request(`/tasks/${id}`, {
    method: 'DELETE',
    mock: () => {
      const tasks = mockTasks();
      findOrFail(tasks, id);
      persist(tasks.filter((t) => t.id !== id));
      return null;
    },
  });

// Після перетягування: нові статуси та порядок карток одним запитом
// items: [{ id, status, order }]
export const reorderTasks = (items) =>
  request('/tasks/reorder', {
    method: 'PUT',
    body: { items },
    mock: () => {
      const tasks = mockTasks();
      items.forEach(({ id, status, order }) => {
        const t = tasks.find((x) => x.id === id);
        if (t) Object.assign(t, { status, order });
      });
      persist(tasks);
      return null;
    },
  });

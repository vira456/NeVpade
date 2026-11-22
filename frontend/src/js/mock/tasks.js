// Завдання Kanban у режимі моків (localStorage)
import { ApiError } from '../api/client.js';
import { load, save } from '../utils/storage.js';
import seed from './tasks.json';
import { freshSeed } from './store.js';

const all = () => load('mock.tasks') ?? freshSeed(seed);
const persist = (tasks) => save('mock.tasks', tasks);

function findOrFail(tasks, id) {
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0) throw new ApiError('Завдання не знайдено', 404);
  return i;
}

export const list = () => all();

export function create(data) {
  const task = { ...data, id: `tsk_${Date.now().toString(36)}`, createdAt: new Date().toISOString() };
  persist([...all(), task]);
  return task;
}

export function update(id, data) {
  const tasks = all();
  const i = findOrFail(tasks, id);
  tasks[i] = { ...tasks[i], ...data, id };
  persist(tasks);
  return tasks[i];
}

export function remove(id) {
  const tasks = all();
  findOrFail(tasks, id);
  persist(tasks.filter((t) => t.id !== id));
  return null;
}

export function reorder(items) {
  const tasks = all();
  items.forEach(({ id, status, order }) => {
    const t = tasks.find((x) => x.id === id);
    if (t) Object.assign(t, { status, order });
  });
  persist(tasks);
  return null;
}

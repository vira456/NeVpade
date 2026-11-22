// Завдання Kanban. Відповіді в режимі моків — mock/tasks.js.
import { request } from './client.js';

export const getTasks = () => request('/tasks', { mock: (m) => m.tasks.list() });

export const createTask = (data) => request('/tasks', { method: 'POST', body: data, mock: (m) => m.tasks.create(data) });

export const updateTask = (id, data) => request(`/tasks/${id}`, { method: 'PUT', body: data, mock: (m) => m.tasks.update(id, data) });

export const deleteTask = (id) => request(`/tasks/${id}`, { method: 'DELETE', mock: (m) => m.tasks.remove(id) });

// Після перетягування: нові статуси та порядок карток одним запитом
// items: [{ id, status, order }]
export const reorderTasks = (items) => request('/tasks/reorder', { method: 'PUT', body: { items }, mock: (m) => m.tasks.reorder(items) });

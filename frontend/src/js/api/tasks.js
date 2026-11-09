import { request } from './client.js';
import tasks from '../mock/tasks.json';

export const getTasks = () => request('/tasks', { mock: tasks });
export const updateTaskStatus = (id, status, order) =>
  request(`/tasks/${id}`, { method: 'PATCH', body: { status, order }, mock: { id, status, order } });

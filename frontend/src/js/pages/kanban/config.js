import { locale } from '../../i18n/index.js';
// Колонки, пріоритети та робота з термінами
export const COLUMNS = [
  { status: 'todo', title: 'Маю зробити' },
  { status: 'in_progress', title: 'В процесі' },
  { status: 'done', title: 'Зроблено' },
];

export const PRIORITIES = {
  high: { label: 'Високий', weight: 0 },
  medium: { label: 'Середній', weight: 1 },
  low: { label: 'Низький', weight: 2 },
};

const DAY = 24 * 60 * 60 * 1000;

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

// Сьогоднішня дата у форматі YYYY-MM-DD (для input type=date)
export const todayIso = () => {
  const d = startOfToday();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Різниця в днях між терміном і сьогоднішнім днем (від'ємна — прострочено)
export const daysLeft = (iso) => Math.round((new Date(`${iso}T00:00:00`) - startOfToday()) / DAY);

export const isOverdue = (task) => task.status !== 'done' && task.dueDate && daysLeft(task.dueDate) < 0;

// Підпис терміну на картці: { text, tone }
export function dueLabel(task) {
  if (!task.dueDate) return null;
  const date = new Date(`${task.dueDate}T00:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  if (task.status === 'done') return { text: date, tone: 'muted' };

  const left = daysLeft(task.dueDate);
  if (left < 0) return { text: `Прострочено · ${date}`, tone: 'overdue' };
  if (left === 0) return { text: 'Сьогодні', tone: 'today' };
  if (left === 1) return { text: 'Завтра', tone: 'soon' };
  if (left <= 7) return { text: `${date} · ${left} дн.`, tone: 'normal' };
  return { text: date, tone: 'normal' };
}

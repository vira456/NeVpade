import { Chart } from 'chart.js/auto';
import { renderLayout } from '../utils/layout.js';
import { getSummary, getIncome, getExpenses } from '../api/analytics.js';
import { money, km } from '../utils/format.js';

renderLayout();

async function init() {
  const [summary, income, expenses] = await Promise.all([getSummary(), getIncome(), getExpenses()]);

  document.getElementById('stats').innerHTML = [
    ['Дохід', money(summary.income)],
    ['Витрати', money(summary.expenses)],
    ['Прибуток', money(summary.profit)],
    ['Рейсів', summary.tripsCount],
    ['Пробіг', km(summary.distanceKm)],
  ]
    .map(([label, value]) => `<div class="card"><div class="stats__label">${label}</div><div class="stats__value">${value}</div></div>`)
    .join('');

  new Chart(document.getElementById('incomeChart'), {
    type: 'line',
    data: {
      labels: income.labels,
      datasets: [
        { label: 'Дохід', data: income.income, borderColor: '#1f5eff', tension: 0.3 },
        { label: 'Витрати', data: income.expenses, borderColor: '#f5a524', tension: 0.3 },
      ],
    },
  });

  new Chart(document.getElementById('expensesChart'), {
    type: 'doughnut',
    data: {
      labels: ['Пальне', 'Зарплата', 'Ремонт', 'Дороги', 'Інше'],
      datasets: [{ data: Object.values(expenses) }],
    },
  });
}

init();

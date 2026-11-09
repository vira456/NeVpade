import { request } from './client.js';
import analytics from '../mock/analytics.json';

// period: week | month | year
export const getSummary = (period = 'month') =>
  request(`/analytics/summary?period=${period}`, { mock: analytics.summary[period] });
export const getIncome = (period = 'month') =>
  request(`/analytics/income?period=${period}`, { mock: analytics.income[period] });
export const getExpenses = (period = 'month') =>
  request(`/analytics/expenses?period=${period}`, { mock: analytics.expenses[period] });

import { request } from './client.js';
import analytics from '../mock/analytics.json';

export const getSummary = (period = 'month') =>
  request(`/analytics/summary?period=${period}`, { mock: analytics.summary });
export const getIncome = (period = 'year') =>
  request(`/analytics/income?period=${period}`, { mock: analytics.income });
export const getExpenses = (period = 'month') =>
  request(`/analytics/expenses?period=${period}`, { mock: analytics.expenses });

/**
 * Expenses query keys (Wave 7 / Phase 11).
 */
import type { ExpenseListFilters } from '../services/expensesService';

export const expenseKeys = {
  all: ['finance', 'expenses'] as const,
  list: (filters: ExpenseListFilters = {}) => [...expenseKeys.all, 'list', filters] as const,
  detail: (id: string) => [...expenseKeys.all, 'detail', id] as const,
};

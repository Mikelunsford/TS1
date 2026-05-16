/**
 * Expense categories query keys (Wave 7 / Phase 11).
 */
import type { ExpenseCategoryListFilters } from '../services/expenseCategoriesService';

export const expenseCategoryKeys = {
  all: ['finance', 'expense_categories'] as const,
  list: (filters: ExpenseCategoryListFilters = {}) =>
    [...expenseCategoryKeys.all, 'list', filters] as const,
  detail: (id: string) => [...expenseCategoryKeys.all, 'detail', id] as const,
};

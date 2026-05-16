/**
 * Expense categories service (Wave 7 / Phase 11). Org-scoped CRUD under
 * finance-api.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ExpenseCategorySchema,
  type ExpenseCategory,
  type ExpenseCategoryCreate,
  type ExpenseCategoryPatch,
} from '../types';

const ExpenseCategoryListSchema = z.object({
  items: z.array(ExpenseCategorySchema),
  next_cursor: z.string().nullable().optional(),
});

export interface ExpenseCategoryListFilters {
  q?: string;
  is_active?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ExpenseCategoryListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.is_active !== undefined) sp.set('is_active', String(filters.is_active));
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listExpenseCategories(filters?: ExpenseCategoryListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/expense-categories${toQuery(filters)}`,
    schema: ExpenseCategoryListSchema,
  });
}

export function createExpenseCategory(body: ExpenseCategoryCreate): Promise<ExpenseCategory> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/expense-categories',
    body,
    schema: ExpenseCategorySchema,
  });
}

export function updateExpenseCategory(
  id: string,
  body: ExpenseCategoryPatch,
): Promise<ExpenseCategory> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/expense-categories/${id}`,
    body,
    schema: ExpenseCategorySchema,
  });
}

export function archiveExpenseCategory(id: string): Promise<ExpenseCategory> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expense-categories/${id}/archive`,
    body: {},
    schema: ExpenseCategorySchema,
  });
}

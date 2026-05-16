/**
 * Expenses service (Wave 7 / Phase 11). Single-line expense rows;
 * `total_cents = amount + tax` is BIU-trigger-maintained (migration 0058).
 * The `me=true` filter scopes the list to expenses submitted by the caller,
 * powering the MyExpensesPage.
 *
 * Reject reason gets stamped into `notes` via the BE handler — SPA parses
 * it back out with the regex `\[REJECTED .* by .*\]: (.*)$`.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ExpenseSchema,
  type Expense,
  type ExpenseCreate,
  type ExpensePatch,
  type ExpenseReject,
} from '../types';

const ExpenseListSchema = z.object({
  items: z.array(ExpenseSchema),
  next_cursor: z.string().nullable().optional(),
});

export interface ExpenseListFilters {
  q?: string;
  status?: string;
  category_id?: string;
  vendor_id?: string;
  project_id?: string;
  from?: string;
  to?: string;
  /** When true, BE filters to expenses where submitted_by === caller. */
  me?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ExpenseListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.category_id) sp.set('category_id', filters.category_id);
  if (filters.vendor_id) sp.set('vendor_id', filters.vendor_id);
  if (filters.project_id) sp.set('project_id', filters.project_id);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.me) sp.set('me', 'true');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listExpenses(filters?: ExpenseListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/expenses${toQuery(filters)}`,
    schema: ExpenseListSchema,
  });
}

export function getExpense(id: string): Promise<Expense> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/expenses/${id}`,
    schema: ExpenseSchema,
  });
}

export function createExpense(body: ExpenseCreate): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/expenses',
    body,
    schema: ExpenseSchema,
  });
}

export function updateExpense(id: string, body: ExpensePatch): Promise<Expense> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/expenses/${id}`,
    body,
    schema: ExpenseSchema,
  });
}

export function submitExpense(id: string): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expenses/${id}/submit`,
    body: {},
    schema: ExpenseSchema,
  });
}

export function approveExpense(id: string): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expenses/${id}/approve`,
    body: {},
    schema: ExpenseSchema,
  });
}

export function rejectExpense(id: string, body: ExpenseReject): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expenses/${id}/reject`,
    body,
    schema: ExpenseSchema,
  });
}

export function reimburseExpense(id: string): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expenses/${id}/reimburse`,
    body: {},
    schema: ExpenseSchema,
  });
}

export function payExpense(id: string): Promise<Expense> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/expenses/${id}/pay`,
    body: {},
    schema: ExpenseSchema,
  });
}

/** Parse the rejection reason out of `notes`. BE handler appends a marker
 *  in the form: `[REJECTED 2026-05-16T... by 11111111-...]: reason text`. */
const REJECT_RE = /\[REJECTED .* by .*\]: (.*)$/m;
export function parseExpenseRejection(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = REJECT_RE.exec(notes);
  if (!match) return null;
  const reason = match[1];
  return reason ? reason.trim() : null;
}

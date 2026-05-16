/**
 * Pure form-state helpers extracted from ExpenseForm.tsx so the component
 * file only exports React components (react-refresh/only-export-components).
 */
import type { Expense } from '@/lib/types';

export interface ExpenseFormState {
  category_id: string;
  vendor_id: string;
  project_id: string;
  spent_at: string;
  description: string;
  currency_code: string;
  amount_cents: number;
  tax_cents: number;
  receipt_url: string;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyExpenseForm(): ExpenseFormState {
  return {
    category_id: '',
    vendor_id: '',
    project_id: '',
    spent_at: todayIso(),
    description: '',
    currency_code: 'USD',
    amount_cents: 0,
    tax_cents: 0,
    receipt_url: '',
    notes: '',
  };
}

export function fromExpense(e: Expense): ExpenseFormState {
  return {
    category_id: e.category_id ?? '',
    vendor_id: e.vendor_id ?? '',
    project_id: e.project_id ?? '',
    spent_at: e.spent_at,
    description: e.description ?? '',
    currency_code: e.currency_code,
    amount_cents: Number(e.amount_cents),
    tax_cents: Number(e.tax_cents),
    receipt_url: e.receipt_url ?? '',
    notes: e.notes ?? '',
  };
}

import { describe, it, expect } from 'vitest';

import {
  ExpenseCreateSchema,
  ExpensePatchSchema,
  ExpenseRejectSchema,
  ExpenseSchema,
  ExpenseStateSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/finance-api/expenses` (Wave 7 / Phase 11).
 *
 * `expenses` is single-line — no expense_line_items table in prod. The
 * `tg_expenses_total_biu` trigger from migration 0058 keeps
 * `total_cents := amount_cents + tax_cents`; handlers MUST NOT write
 * total_cents directly. The state machine has 6 values with no `cancelled`
 * — rejected expenses get re-edited and re-submitted (rejected → submitted).
 *
 * The state-machine transitions live in `workflow-expense.test.ts`.
 */

const SAMPLE_EXPENSE = {
  id: '00000000-0000-0000-0000-000000000901',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  expense_number: 'EXP-2026-0001',
  category_id: '00000000-0000-0000-0000-000000000801',
  vendor_id: null,
  project_id: null,
  account_id: null,
  spent_at: '2026-05-16',
  description: 'Conference travel',
  status: 'draft' as const,
  currency_code: 'USD',
  amount_cents: 25000,
  tax_cents: 2000,
  tax_id: null,
  total_cents: 27000,
  paid_at: null,
  receipt_url: null,
  notes: null,
  submitted_by: '00000000-0000-0000-0000-000000000099',
  approved_by: null,
  approved_at: null,
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
  deleted_at: null,
};

describe('Wire contract: /finance-api/expenses', () => {
  it('ExpenseSchema accepts the canonical row shape', () => {
    const parsed = ExpenseSchema.safeParse(SAMPLE_EXPENSE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('ExpenseStateSchema enumerates the prod 6-state CHECK', () => {
    expect(ExpenseStateSchema.options.slice().sort()).toEqual(
      ['approved', 'draft', 'paid', 'reimbursed', 'rejected', 'submitted'].sort(),
    );
    expect(ExpenseStateSchema.options.length).toBe(6);
  });

  it('ExpenseStateSchema rejects "cancelled" (not in the prod CHECK)', () => {
    // Expense lifecycle deliberately has no `cancelled` — rejected expenses
    // get re-edited and re-submitted via rejected → submitted.
    expect(ExpenseStateSchema.safeParse('cancelled').success).toBe(false);
  });

  it('ExpenseStateSchema rejects unknown states', () => {
    expect(ExpenseStateSchema.safeParse('voided').success).toBe(false);
    expect(ExpenseStateSchema.safeParse('on_hold').success).toBe(false);
    expect(ExpenseStateSchema.safeParse('').success).toBe(false);
  });

  it('ExpenseCreateSchema accepts the minimum-required body (only amount_cents)', () => {
    expect(ExpenseCreateSchema.safeParse({ amount_cents: 1000 }).success).toBe(true);
  });

  it('ExpenseCreateSchema rejects missing amount_cents', () => {
    expect(ExpenseCreateSchema.safeParse({}).success).toBe(false);
  });

  it('ExpenseCreateSchema rejects negative amount_cents / tax_cents', () => {
    expect(ExpenseCreateSchema.safeParse({ amount_cents: -1 }).success).toBe(false);
    expect(
      ExpenseCreateSchema.safeParse({ amount_cents: 100, tax_cents: -1 }).success,
    ).toBe(false);
  });

  it('ExpenseCreateSchema accepts zero amount_cents (e.g. a placeholder draft)', () => {
    expect(ExpenseCreateSchema.safeParse({ amount_cents: 0 }).success).toBe(true);
  });

  it('ExpenseCreateSchema currency_code is exactly 3 chars when present', () => {
    expect(
      ExpenseCreateSchema.safeParse({ amount_cents: 100, currency_code: 'USDX' }).success,
    ).toBe(false);
    expect(
      ExpenseCreateSchema.safeParse({ amount_cents: 100, currency_code: 'USD' }).success,
    ).toBe(true);
  });

  it('ExpenseCreateSchema is strict — rejects unknown keys', () => {
    expect(
      ExpenseCreateSchema.safeParse({ amount_cents: 100, surprise: 1 }).success,
    ).toBe(false);
  });

  it('ExpenseCreateSchema accepts the full optional surface', () => {
    const full = {
      category_id: '00000000-0000-0000-0000-000000000801',
      vendor_id: '00000000-0000-0000-0000-000000000401',
      project_id: '00000000-0000-0000-0000-000000000201',
      account_id: '00000000-0000-0000-0000-000000000999',
      spent_at: '2026-05-16',
      description: 'Conference travel',
      currency_code: 'USD',
      amount_cents: 25000,
      tax_cents: 2000,
      tax_id: '00000000-0000-0000-0000-000000000003',
      receipt_url: 'https://example.com/r.pdf',
      notes: 'reimbursable',
    };
    expect(ExpenseCreateSchema.safeParse(full).success).toBe(true);
  });

  it('ExpensePatchSchema accepts a partial body and an empty body', () => {
    expect(ExpensePatchSchema.safeParse({}).success).toBe(true);
    expect(ExpensePatchSchema.safeParse({ amount_cents: 5000 }).success).toBe(true);
    expect(ExpensePatchSchema.safeParse({ description: 'updated' }).success).toBe(true);
  });

  it('ExpensePatchSchema is strict — rejects unknown keys', () => {
    expect(ExpensePatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });

  it('ExpenseRejectSchema requires a non-empty reason', () => {
    expect(ExpenseRejectSchema.safeParse({}).success).toBe(false);
    expect(ExpenseRejectSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(ExpenseRejectSchema.safeParse({ reason: 'duplicate' }).success).toBe(true);
  });

  it('ExpenseRejectSchema is strict — rejects unknown keys', () => {
    expect(
      ExpenseRejectSchema.safeParse({ reason: 'duplicate', surprise: 1 }).success,
    ).toBe(false);
  });
});

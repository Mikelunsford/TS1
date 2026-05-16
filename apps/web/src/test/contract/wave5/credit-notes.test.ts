import { describe, it, expect } from 'vitest';

import {
  CreditNoteApplySchema,
  CreditNoteCreateSchema,
  CreditNoteSchema,
  CreditNoteStatusSchema,
  CreditNoteVoidSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/invoicing-api/credit-notes` (Wave 5 / Phase 8).
 *
 * The DB CHECK constraint `applied_cents <= amount_cents` is the floor.
 * Server-side validation tops it off; this contract test pins what the wire
 * schema can express. Note: `applied_amount cannot exceed amount` is a
 * server-side / DB invariant — the Zod schema only validates the create
 * shape (which always starts with applied_cents=0) and the per-apply
 * payload `amount_cents > 0`.
 */

const SAMPLE_CREDIT_NOTE = {
  id: '00000000-0000-0000-0000-000000000601',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  credit_note_number: 'CN-2026-0001',
  customer_id: '00000000-0000-0000-0000-000000000002',
  invoice_id: '00000000-0000-0000-0000-000000000301',
  issue_date: '2026-05-15',
  status: 'draft' as const,
  reason: 'adjustment' as const,
  currency_code: 'USD',
  amount_cents: 5000,
  applied_cents: 0,
  notes: null,
  voided_at: null,
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /invoicing-api/credit-notes', () => {
  it('CreditNoteSchema accepts the canonical row shape', () => {
    const parsed = CreditNoteSchema.safeParse(SAMPLE_CREDIT_NOTE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('CreditNoteCreateSchema accepts a minimum-required body and rejects bad amount', () => {
    const ok = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      currency_code: 'USD',
      amount_cents: 1000,
    };
    expect(CreditNoteCreateSchema.safeParse(ok).success).toBe(true);
    // Negative amount is rejected (nonnegative integer).
    expect(CreditNoteCreateSchema.safeParse({ ...ok, amount_cents: -1 }).success).toBe(false);
    // Non-integer is rejected.
    expect(CreditNoteCreateSchema.safeParse({ ...ok, amount_cents: 1.5 }).success).toBe(false);
    // Bad currency length.
    expect(CreditNoteCreateSchema.safeParse({ ...ok, currency_code: 'XX' }).success).toBe(false);
    // Missing required customer_id.
    expect(
      CreditNoteCreateSchema.safeParse({ currency_code: 'USD', amount_cents: 100 }).success,
    ).toBe(false);
  });

  it('CreditNoteApplySchema requires invoice_id and amount_cents > 0', () => {
    const ok = {
      invoice_id: '00000000-0000-0000-0000-000000000301',
      amount_cents: 1000,
    };
    expect(CreditNoteApplySchema.safeParse(ok).success).toBe(true);
    // Zero amount is rejected.
    expect(CreditNoteApplySchema.safeParse({ ...ok, amount_cents: 0 }).success).toBe(false);
    // Negative amount is rejected.
    expect(CreditNoteApplySchema.safeParse({ ...ok, amount_cents: -1 }).success).toBe(false);
    // Missing invoice_id.
    expect(CreditNoteApplySchema.safeParse({ amount_cents: 100 }).success).toBe(false);
    // Bad uuid.
    expect(
      CreditNoteApplySchema.safeParse({ invoice_id: 'nope', amount_cents: 100 }).success,
    ).toBe(false);
  });

  it('CreditNoteVoidSchema requires a non-empty reason', () => {
    expect(CreditNoteVoidSchema.safeParse({}).success).toBe(false);
    expect(CreditNoteVoidSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(CreditNoteVoidSchema.safeParse({ reason: 'issued in error' }).success).toBe(true);
  });

  it('CreditNoteCreateSchema rejects unknown reason enum values', () => {
    const base = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      currency_code: 'USD',
      amount_cents: 100,
    };
    // The 5 enum values are accepted.
    for (const reason of ['refund', 'adjustment', 'write_off', 'duplicate', 'other'] as const) {
      expect(CreditNoteCreateSchema.safeParse({ ...base, reason }).success).toBe(true);
    }
    // null is allowed (nullable).
    expect(CreditNoteCreateSchema.safeParse({ ...base, reason: null }).success).toBe(true);
    // Unknown reason rejected.
    expect(CreditNoteCreateSchema.safeParse({ ...base, reason: 'mystery' }).success).toBe(false);
  });

  it('CreditNoteStatusSchema enum pins the 4 prod CHECK values', () => {
    expect(CreditNoteStatusSchema.options).toEqual(['draft', 'issued', 'applied', 'voided']);
    for (const status of ['draft', 'issued', 'applied', 'voided'] as const) {
      expect(CreditNoteStatusSchema.safeParse(status).success).toBe(true);
    }
    // Unknown value rejected.
    expect(CreditNoteStatusSchema.safeParse('cancelled').success).toBe(false);
  });
});

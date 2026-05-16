import { describe, it, expect } from 'vitest';

import {
  PaymentCreateSchema,
  PaymentPatchSchema,
  PaymentSchema,
  PaymentVoidSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/invoicing-api/payments` (Wave 5 / Phase 8).
 *
 * Pins the request-body validation for Payment endpoints. Constitutional
 * invariants pinned here:
 *
 *   - amount_cents MUST be an integer > 0 (matches the DB CHECK constraint).
 *   - currency_code MUST be exactly 3 chars (ISO-4217).
 *   - void requires a non-empty void_reason string (caller accountability,
 *     even though the void timestamp lives on `voided_at` only).
 */

const SAMPLE_PAYMENT = {
  id: '00000000-0000-0000-0000-000000000501',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  payment_number: 'PAY-2026-0001',
  customer_id: '00000000-0000-0000-0000-000000000002',
  invoice_id: '00000000-0000-0000-0000-000000000301',
  payment_method_id: null,
  paid_at: '2026-05-15T12:00:00+00:00',
  amount_cents: 12500,
  currency_code: 'USD',
  exchange_rate: null,
  reference: null,
  description: null,
  external_ref: null,
  cleared_at: null,
  voided_at: null,
  void_reason: null,
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /invoicing-api/payments', () => {
  it('PaymentSchema accepts the canonical row shape', () => {
    const parsed = PaymentSchema.safeParse(SAMPLE_PAYMENT);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('PaymentCreateSchema enforces amount_cents > 0 (integer)', () => {
    const base = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      invoice_id: '00000000-0000-0000-0000-000000000301',
      amount_cents: 1000,
      currency_code: 'USD',
    };
    expect(PaymentCreateSchema.safeParse(base).success).toBe(true);
    // Zero is rejected (must be positive).
    expect(PaymentCreateSchema.safeParse({ ...base, amount_cents: 0 }).success).toBe(false);
    // Negative is rejected.
    expect(PaymentCreateSchema.safeParse({ ...base, amount_cents: -100 }).success).toBe(false);
    // Non-integer is rejected.
    expect(PaymentCreateSchema.safeParse({ ...base, amount_cents: 1.5 }).success).toBe(false);
  });

  it('PaymentCreateSchema enforces currency_code length 3', () => {
    const base = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      invoice_id: '00000000-0000-0000-0000-000000000301',
      amount_cents: 1000,
    };
    expect(PaymentCreateSchema.safeParse({ ...base, currency_code: 'US' }).success).toBe(false);
    expect(PaymentCreateSchema.safeParse({ ...base, currency_code: 'USDX' }).success).toBe(false);
    expect(PaymentCreateSchema.safeParse({ ...base, currency_code: 'USD' }).success).toBe(true);
  });

  it('PaymentPatchSchema accepts {} and partial updates, but amount_cents must stay positive', () => {
    expect(PaymentPatchSchema.safeParse({}).success).toBe(true);
    expect(PaymentPatchSchema.safeParse({ amount_cents: 500 }).success).toBe(true);
    expect(PaymentPatchSchema.safeParse({ amount_cents: 0 }).success).toBe(false);
    expect(PaymentPatchSchema.safeParse({ amount_cents: -1 }).success).toBe(false);
  });

  it('PaymentVoidSchema requires a non-empty void_reason', () => {
    expect(PaymentVoidSchema.safeParse({}).success).toBe(false);
    expect(PaymentVoidSchema.safeParse({ void_reason: '' }).success).toBe(false);
    expect(PaymentVoidSchema.safeParse({ void_reason: 'customer chargeback' }).success).toBe(true);
  });
});

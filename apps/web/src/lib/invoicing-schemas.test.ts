import { describe, it, expect } from 'vitest';

import {
  CreditNoteApplySchema,
  CreditNoteCreateSchema,
  CreditNoteSchema,
  CreditNoteVoidSchema,
  InvoiceCreateSchema,
  InvoicePatchSchema,
  InvoiceSchema,
  InvoiceSendSchema,
  InvoiceStateSchema,
  InvoiceVoidSchema,
  PaymentCreateSchema,
  PaymentPatchSchema,
  PaymentSchema,
  PaymentVoidSchema,
} from './types';

/**
 * Unit tests for the Wave 5 invoicing Zod canon. Pins:
 *   - InvoiceSchema accepts the 43-ish prod columns (smoke fixture).
 *   - InvoiceCreateSchema requires customer_id + due_date + currency_code.
 *   - InvoiceVoidSchema requires `reason`.
 *   - PaymentCreateSchema enforces amount_cents > 0.
 *   - PaymentPatchSchema rejects amount_cents <= 0.
 *   - PaymentVoidSchema requires `void_reason`.
 *   - CreditNoteCreateSchema requires amount_cents (>=0) + customer_id +
 *     currency_code.
 *   - CreditNoteApplySchema requires invoice_id + positive amount_cents.
 *   - InvoiceStateSchema enumerates exactly the 9 prod CHECK values.
 */

const INVOICE_FIXTURE = {
  id: '00000000-0000-0000-0000-000000000001',
  org_id: '00000000-0000-0000-0000-0000000000ff',
  invoice_number: 'INV-0001',
  customer_id: '00000000-0000-0000-0000-000000000010',
  customer_name_snapshot: 'Acme Co.',
  project_id: null,
  quote_id: null,
  status: 'draft',
  payment_status: 'unpaid',
  recurring: null,
  content: null,
  notes: null,
  issue_date: '2026-05-15',
  due_date: '2026-06-15',
  state_changed_at: '2026-05-15T00:00:00+00:00',
  approved: false,
  is_overdue: false,
  converted_from_type: null,
  converted_from_id: null,
  currency_code: 'USD',
  exchange_rate: null,
  subtotal_cents: 10000,
  discount_cents: 0,
  tax_cents: 875,
  total_cents: 10875,
  paid_cents: 0,
  balance_cents: 10875,
  tax_id: null,
  tax_rate_snapshot: null,
  pdf_path: null,
  external_ref: null,
  sent_at: null,
  paid_at: null,
  cancelled_at: null,
  cancellation_reason: null,
  pending_at: null,
  on_hold_at: null,
  created_at: '2026-05-15T00:00:00+00:00',
  updated_at: '2026-05-15T00:00:00+00:00',
};

const PAYMENT_FIXTURE = {
  id: '00000000-0000-0000-0000-000000000002',
  org_id: '00000000-0000-0000-0000-0000000000ff',
  payment_number: 'PAY-0001',
  customer_id: '00000000-0000-0000-0000-000000000010',
  invoice_id: '00000000-0000-0000-0000-000000000001',
  payment_method_id: null,
  paid_at: '2026-05-15T00:00:00+00:00',
  amount_cents: 5000,
  currency_code: 'USD',
  exchange_rate: null,
  reference: null,
  description: null,
  external_ref: null,
  cleared_at: null,
  voided_at: null,
  void_reason: null,
  created_at: '2026-05-15T00:00:00+00:00',
  updated_at: '2026-05-15T00:00:00+00:00',
};

const CREDIT_NOTE_FIXTURE = {
  id: '00000000-0000-0000-0000-000000000003',
  org_id: '00000000-0000-0000-0000-0000000000ff',
  credit_note_number: 'CN-0001',
  customer_id: '00000000-0000-0000-0000-000000000010',
  invoice_id: null,
  issue_date: '2026-05-15',
  status: 'draft',
  reason: null,
  currency_code: 'USD',
  amount_cents: 2500,
  applied_cents: 0,
  notes: null,
  voided_at: null,
  created_at: '2026-05-15T00:00:00+00:00',
  updated_at: '2026-05-15T00:00:00+00:00',
};

describe('InvoiceSchema', () => {
  it('parses the prod-shape fixture', () => {
    expect(InvoiceSchema.parse(INVOICE_FIXTURE)).toBeDefined();
  });

  it('rejects fixture with unknown status', () => {
    const bad = { ...INVOICE_FIXTURE, status: 'frozen' };
    expect(InvoiceSchema.safeParse(bad).success).toBe(false);
  });
});

describe('InvoiceCreateSchema', () => {
  it('requires customer_id + due_date + currency_code', () => {
    const ok = InvoiceCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      due_date: '2026-06-15',
      currency_code: 'USD',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects when customer_id is missing', () => {
    const bad = InvoiceCreateSchema.safeParse({
      due_date: '2026-06-15',
      currency_code: 'USD',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects unknown recurring cadence', () => {
    const bad = InvoiceCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      due_date: '2026-06-15',
      currency_code: 'USD',
      recurring: 'biweekly',
    });
    expect(bad.success).toBe(false);
  });
});

describe('InvoicePatchSchema', () => {
  it('accepts a partial update', () => {
    expect(InvoicePatchSchema.safeParse({ notes: 'updated' }).success).toBe(true);
  });

  it('accepts an empty patch', () => {
    expect(InvoicePatchSchema.safeParse({}).success).toBe(true);
  });
});

describe('InvoiceSendSchema', () => {
  it('accepts empty body or just an email', () => {
    expect(InvoiceSendSchema.safeParse({}).success).toBe(true);
    expect(InvoiceSendSchema.safeParse({ email: 'a@b.com' }).success).toBe(true);
  });

  it('rejects a malformed email', () => {
    expect(InvoiceSendSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });
});

describe('InvoiceVoidSchema', () => {
  it('requires `reason`', () => {
    expect(InvoiceVoidSchema.safeParse({ reason: 'duplicate' }).success).toBe(true);
    expect(InvoiceVoidSchema.safeParse({}).success).toBe(false);
    expect(InvoiceVoidSchema.safeParse({ reason: '' }).success).toBe(false);
  });
});

describe('InvoiceStateSchema', () => {
  it('enumerates exactly the 9 prod CHECK values', () => {
    const expected = [
      'draft',
      'pending',
      'sent',
      'partially_paid',
      'paid',
      'overdue',
      'refunded',
      'cancelled',
      'on_hold',
    ];
    for (const s of expected) {
      expect(InvoiceStateSchema.safeParse(s).success).toBe(true);
    }
    expect(InvoiceStateSchema.safeParse('issued').success).toBe(false);
  });
});

describe('PaymentSchema', () => {
  it('parses the prod-shape fixture', () => {
    expect(PaymentSchema.parse(PAYMENT_FIXTURE)).toBeDefined();
  });
});

describe('PaymentCreateSchema', () => {
  it('requires positive amount_cents', () => {
    const ok = PaymentCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      invoice_id: '00000000-0000-0000-0000-000000000001',
      amount_cents: 100,
      currency_code: 'USD',
    });
    expect(ok.success).toBe(true);
  });

  it('rejects zero amount_cents', () => {
    const bad = PaymentCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      invoice_id: '00000000-0000-0000-0000-000000000001',
      amount_cents: 0,
      currency_code: 'USD',
    });
    expect(bad.success).toBe(false);
  });

  it('rejects negative amount_cents', () => {
    const bad = PaymentCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      invoice_id: '00000000-0000-0000-0000-000000000001',
      amount_cents: -100,
      currency_code: 'USD',
    });
    expect(bad.success).toBe(false);
  });
});

describe('PaymentPatchSchema', () => {
  it('rejects zero amount_cents on patch', () => {
    expect(PaymentPatchSchema.safeParse({ amount_cents: 0 }).success).toBe(false);
  });

  it('accepts positive amount on patch', () => {
    expect(PaymentPatchSchema.safeParse({ amount_cents: 50 }).success).toBe(true);
  });
});

describe('PaymentVoidSchema', () => {
  it('requires void_reason', () => {
    expect(PaymentVoidSchema.safeParse({ void_reason: 'NSF' }).success).toBe(true);
    expect(PaymentVoidSchema.safeParse({}).success).toBe(false);
  });
});

describe('CreditNoteSchema', () => {
  it('parses the prod-shape fixture', () => {
    expect(CreditNoteSchema.parse(CREDIT_NOTE_FIXTURE)).toBeDefined();
  });

  it('rejects unknown status', () => {
    const bad = { ...CREDIT_NOTE_FIXTURE, status: 'settled' };
    expect(CreditNoteSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects unknown reason', () => {
    const bad = { ...CREDIT_NOTE_FIXTURE, reason: 'because' };
    expect(CreditNoteSchema.safeParse(bad).success).toBe(false);
  });
});

describe('CreditNoteCreateSchema', () => {
  it('requires customer_id + currency_code + amount_cents (>=0)', () => {
    const ok = CreditNoteCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      currency_code: 'USD',
      amount_cents: 0,
    });
    expect(ok.success).toBe(true);
  });

  it('rejects negative amount', () => {
    const bad = CreditNoteCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      currency_code: 'USD',
      amount_cents: -1,
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a known reason', () => {
    const ok = CreditNoteCreateSchema.safeParse({
      customer_id: '00000000-0000-0000-0000-000000000010',
      currency_code: 'USD',
      amount_cents: 100,
      reason: 'refund',
    });
    expect(ok.success).toBe(true);
  });
});

describe('CreditNoteApplySchema', () => {
  it('requires invoice_id + positive amount_cents', () => {
    expect(
      CreditNoteApplySchema.safeParse({
        invoice_id: '00000000-0000-0000-0000-000000000001',
        amount_cents: 50,
      }).success,
    ).toBe(true);
  });

  it('rejects zero amount_cents', () => {
    expect(
      CreditNoteApplySchema.safeParse({
        invoice_id: '00000000-0000-0000-0000-000000000001',
        amount_cents: 0,
      }).success,
    ).toBe(false);
  });
});

describe('CreditNoteVoidSchema', () => {
  it('requires reason text', () => {
    expect(CreditNoteVoidSchema.safeParse({ reason: 'mistake' }).success).toBe(true);
    expect(CreditNoteVoidSchema.safeParse({}).success).toBe(false);
  });
});

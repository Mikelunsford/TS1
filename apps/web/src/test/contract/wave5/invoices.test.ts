import { describe, it, expect } from 'vitest';

import {
  InvoiceConvertFromProjectSchema,
  InvoiceConvertFromQuoteSchema,
  InvoiceCreateSchema,
  InvoiceDuplicateSchema,
  InvoiceHoldSchema,
  InvoicePatchSchema,
  InvoiceReleaseSchema,
  InvoiceSchema,
  InvoiceSendSchema,
  InvoiceSubmitSchema,
  InvoiceVoidSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/invoicing-api/invoices` (Wave 5 / Phase 7).
 *
 * Pins request-body validation for every Invoice action schema. Mirrors the
 * pattern in `wave4/quotes.test.ts`. The state-machine transitions live in
 * `workflow-invoice.test.ts`; the row-shape parity with the BE handler is
 * pinned via `InvoiceSchema` parsing a fixture that mirrors `INVOICE_COLS`
 * select list in `supabase/functions/invoicing-api/handlers/invoices.ts`.
 */

const SAMPLE_INVOICE = {
  id: '00000000-0000-0000-0000-000000000301',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  invoice_number: 'INV-2026-0001',
  customer_id: '00000000-0000-0000-0000-000000000002',
  customer_name_snapshot: 'Acme Co.',
  project_id: null,
  quote_id: null,
  status: 'draft' as const,
  payment_status: 'unpaid' as const,
  recurring: null,
  content: null,
  notes: null,
  issue_date: '2026-05-15',
  due_date: '2026-06-14',
  state_changed_at: '2026-05-15T12:00:00+00:00',
  approved: false,
  is_overdue: false,
  converted_from_type: null,
  converted_from_id: null,
  currency_code: 'USD',
  exchange_rate: null,
  subtotal_cents: 0,
  discount_cents: 0,
  tax_cents: 0,
  total_cents: 0,
  paid_cents: 0,
  balance_cents: 0,
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
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /invoicing-api/invoices', () => {
  it('InvoiceSchema accepts the canonical row shape', () => {
    const parsed = InvoiceSchema.safeParse(SAMPLE_INVOICE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('InvoiceCreateSchema accepts the minimum-required body', () => {
    const create = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      due_date: '2026-06-14',
      currency_code: 'USD',
    };
    expect(InvoiceCreateSchema.safeParse(create).success).toBe(true);
  });

  it('InvoiceCreateSchema rejects a body missing required fields', () => {
    // Missing customer_id.
    expect(
      InvoiceCreateSchema.safeParse({ due_date: '2026-06-14', currency_code: 'USD' }).success,
    ).toBe(false);
    // Missing due_date.
    expect(
      InvoiceCreateSchema.safeParse({
        customer_id: '00000000-0000-0000-0000-000000000002',
        currency_code: 'USD',
      }).success,
    ).toBe(false);
    // Missing currency_code.
    expect(
      InvoiceCreateSchema.safeParse({
        customer_id: '00000000-0000-0000-0000-000000000002',
        due_date: '2026-06-14',
      }).success,
    ).toBe(false);
    // currency_code must be length 3.
    expect(
      InvoiceCreateSchema.safeParse({
        customer_id: '00000000-0000-0000-0000-000000000002',
        due_date: '2026-06-14',
        currency_code: 'USDX',
      }).success,
    ).toBe(false);
  });

  it('InvoicePatchSchema accepts a partial body and an empty body', () => {
    expect(InvoicePatchSchema.safeParse({ notes: 'updated' }).success).toBe(true);
    expect(InvoicePatchSchema.safeParse({}).success).toBe(true);
  });

  it('InvoiceSubmitSchema accepts {} and rejects unknown keys (strict)', () => {
    expect(InvoiceSubmitSchema.safeParse({}).success).toBe(true);
    expect(InvoiceSubmitSchema.safeParse({ unexpected: 1 }).success).toBe(false);
  });

  it('InvoiceSendSchema accepts {} and validates email when present', () => {
    expect(InvoiceSendSchema.safeParse({}).success).toBe(true);
    expect(
      InvoiceSendSchema.safeParse({ email: 'cust@example.com', message: 'thanks' }).success,
    ).toBe(true);
    // Bad email rejected.
    expect(InvoiceSendSchema.safeParse({ email: 'not-an-email' }).success).toBe(false);
  });

  it('InvoiceVoidSchema requires a non-empty reason', () => {
    expect(InvoiceVoidSchema.safeParse({}).success).toBe(false);
    expect(InvoiceVoidSchema.safeParse({ reason: '' }).success).toBe(false);
    expect(InvoiceVoidSchema.safeParse({ reason: 'duplicate of INV-0002' }).success).toBe(true);
  });

  it('InvoiceHoldSchema + InvoiceReleaseSchema accept optional reason', () => {
    expect(InvoiceHoldSchema.safeParse({}).success).toBe(true);
    expect(InvoiceHoldSchema.safeParse({ reason: 'awaiting PO' }).success).toBe(true);
    expect(InvoiceReleaseSchema.safeParse({}).success).toBe(true);
    expect(InvoiceReleaseSchema.safeParse({ reason: 'PO received' }).success).toBe(true);
  });

  it('InvoiceDuplicateSchema accepts {} and rejects unknown keys (strict)', () => {
    expect(InvoiceDuplicateSchema.safeParse({}).success).toBe(true);
    expect(InvoiceDuplicateSchema.safeParse({ surprise: true }).success).toBe(false);
  });

  it('InvoiceCreateSchema accepts optional snapshot + recurring + exchange_rate fields', () => {
    const full = {
      customer_id: '00000000-0000-0000-0000-000000000002',
      due_date: '2026-06-14',
      currency_code: 'USD',
      issue_date: '2026-05-15',
      customer_name_snapshot: 'Acme Co.',
      notes: 'NET-30',
      content: null,
      recurring: 'monthly' as const,
      exchange_rate: 1.25,
      tax_id: '00000000-0000-0000-0000-000000000003',
      tax_rate_snapshot: 0.0875,
      external_ref: 'ext-1234',
      quote_id: '00000000-0000-0000-0000-000000000001',
      project_id: null,
    };
    expect(InvoiceCreateSchema.safeParse(full).success).toBe(true);
    // tax_rate_snapshot bounded [0,1].
    expect(
      InvoiceCreateSchema.safeParse({ ...full, tax_rate_snapshot: 1.5 }).success,
    ).toBe(false);
    // exchange_rate must be positive when supplied.
    expect(InvoiceCreateSchema.safeParse({ ...full, exchange_rate: -1 }).success).toBe(false);
    // recurring enum rejects unknown.
    expect(
      InvoiceCreateSchema.safeParse({ ...full, recurring: 'biweekly' }).success,
    ).toBe(false);
  });

  it('InvoiceConvertFromQuoteSchema + InvoiceConvertFromProjectSchema require id + due_date', () => {
    const okQuote = {
      quote_id: '00000000-0000-0000-0000-000000000001',
      due_date: '2026-06-14',
    };
    expect(InvoiceConvertFromQuoteSchema.safeParse(okQuote).success).toBe(true);
    // Missing due_date.
    expect(
      InvoiceConvertFromQuoteSchema.safeParse({ quote_id: okQuote.quote_id }).success,
    ).toBe(false);
    // Bad uuid.
    expect(
      InvoiceConvertFromQuoteSchema.safeParse({ quote_id: 'not-a-uuid', due_date: '2026-06-14' })
        .success,
    ).toBe(false);

    const okProject = {
      project_id: '00000000-0000-0000-0000-000000000201',
      due_date: '2026-06-14',
    };
    expect(InvoiceConvertFromProjectSchema.safeParse(okProject).success).toBe(true);
    expect(
      InvoiceConvertFromProjectSchema.safeParse({ project_id: okProject.project_id }).success,
    ).toBe(false);
  });
});

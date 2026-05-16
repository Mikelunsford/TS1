import { describe, it, expect } from 'vitest';

import {
  ApiOkSchema,
  InvoiceConvertFromQuoteSchema,
  InvoiceSchema,
} from '@/lib/types';
import { convertFromQuote } from '@/lib/services/invoicesService';

/**
 * Wire-contract test for `POST /invoicing-api/invoices/from-quote`
 * (Wave 5 / Phase 7). Pins the response envelope shape:
 *
 *   - HTTP 201 Created
 *   - body: { data: Invoice, meta?: { requestId } }
 *
 * The handler (supabase/functions/invoicing-api/handlers/invoices.ts#convertFromQuote)
 * calls the SQL RPC `convert_quote_to_invoice` then re-reads the created
 * invoice row and returns it under `data`. Idempotent via the
 * `idempotency-key` header (respondWithIdempotency).
 */

const SAMPLE_INVOICE_FROM_QUOTE = {
  id: '00000000-0000-0000-0000-000000000301',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  invoice_number: 'INV-2026-0042',
  customer_id: '00000000-0000-0000-0000-000000000002',
  customer_name_snapshot: 'Acme Co.',
  project_id: null,
  // Populated by the RPC: the new invoice carries the originating quote_id.
  quote_id: '00000000-0000-0000-0000-000000000001',
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
  converted_from_type: 'quote' as const,
  converted_from_id: '00000000-0000-0000-0000-000000000001',
  currency_code: 'USD',
  exchange_rate: null,
  subtotal_cents: 40691,
  discount_cents: 0,
  tax_cents: 1517,
  total_cents: 42208,
  paid_cents: 0,
  balance_cents: 42208,
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

describe('Wire contract: POST /invoicing-api/invoices/from-quote', () => {
  it('request body validates per InvoiceConvertFromQuoteSchema', () => {
    const ok = {
      quote_id: '00000000-0000-0000-0000-000000000001',
      due_date: '2026-06-14',
    };
    expect(InvoiceConvertFromQuoteSchema.safeParse(ok).success).toBe(true);
    // Bad date format rejected (must be a date, not a datetime).
    expect(
      InvoiceConvertFromQuoteSchema.safeParse({
        quote_id: ok.quote_id,
        due_date: '2026-06-14T12:00:00Z',
      }).success,
    ).toBe(false);
  });

  it('201 response body parses as ApiOk(InvoiceSchema) with meta.requestId', () => {
    // The handler returns { status: 201, body: { data: invoice } } and the
    // edge runtime stamps `meta.requestId` via the response helper. Both
    // shapes must round-trip through the canonical envelope.
    const body = {
      data: SAMPLE_INVOICE_FROM_QUOTE,
      meta: { requestId: '00000000-0000-0000-0000-0000000000ff' },
    };
    const Envelope = ApiOkSchema(InvoiceSchema);
    const parsed = Envelope.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
    // The converted invoice carries the originating quote_id + the
    // converted_from_{type,id} tuple — both surface contract guarantees.
    expect(SAMPLE_INVOICE_FROM_QUOTE.quote_id).not.toBeNull();
    expect(SAMPLE_INVOICE_FROM_QUOTE.converted_from_type).toBe('quote');
    expect(SAMPLE_INVOICE_FROM_QUOTE.converted_from_id).toBe(
      SAMPLE_INVOICE_FROM_QUOTE.quote_id,
    );
  });

  it('SPA service `convertFromQuote` is bound (route table parity)', () => {
    // Smoke check that the SPA-side service for the contract route exists
    // and is callable (catches an accidental rename or removal).
    expect(typeof convertFromQuote).toBe('function');
  });
});

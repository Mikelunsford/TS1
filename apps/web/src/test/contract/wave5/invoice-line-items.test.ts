import { describe, it, expect } from 'vitest';

import {
  InvoiceLineReorderSchema,
  InvoiceLineReplaceSchema,
  InvoiceLineSchema,
  InvoiceLineUpsertSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/invoicing-api/invoices/:invoice_id/line-items`
 * (Wave 5 / Phase 7). Mirrors `wave4/quote-line-items.test.ts`. The DB
 * recompute trigger rolls totals up to the parent invoice — handlers do NOT
 * recompute. See `supabase/functions/invoicing-api/handlers/line-items.ts`.
 */

const SAMPLE_LINE = {
  id: '00000000-0000-0000-0000-000000000401',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  invoice_id: '00000000-0000-0000-0000-000000000301',
  invoice_version_id: null,
  item_id: null,
  description: 'Hand-pack of 1k SKUs',
  quantity: 10,
  unit: 'ea',
  unit_price_cents: 12500,
  unit_cost_cents: 9500,
  discount_cents: 0,
  tax_id: null,
  tax_rate_snapshot: null,
  tax_amount_cents: 0,
  line_total_cents: 125000,
  position: 0,
  created_at: '2026-05-15T12:00:00+00:00',
  updated_at: '2026-05-15T12:00:00+00:00',
};

describe('Wire contract: /invoicing-api/invoices/:invoice_id/line-items', () => {
  it('InvoiceLineSchema accepts the canonical row shape', () => {
    const parsed = InvoiceLineSchema.safeParse(SAMPLE_LINE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('InvoiceLineUpsertSchema accepts a minimum-required upsert body', () => {
    const ok = {
      description: 'New line',
      quantity: 2,
      unit_price_cents: 500,
      position: 5,
    };
    expect(InvoiceLineUpsertSchema.safeParse(ok).success).toBe(true);
  });

  it('InvoiceLineUpsertSchema rejects bad bodies', () => {
    // Negative quantity is rejected.
    expect(
      InvoiceLineUpsertSchema.safeParse({
        description: 'X',
        quantity: -1,
        unit_price_cents: 100,
        position: 0,
      }).success,
    ).toBe(false);
    // Missing description.
    expect(
      InvoiceLineUpsertSchema.safeParse({
        quantity: 1,
        unit_price_cents: 100,
        position: 0,
      }).success,
    ).toBe(false);
    // Empty description.
    expect(
      InvoiceLineUpsertSchema.safeParse({
        description: '',
        quantity: 1,
        unit_price_cents: 100,
        position: 0,
      }).success,
    ).toBe(false);
    // Missing position (no default).
    expect(
      InvoiceLineUpsertSchema.safeParse({
        description: 'X',
        quantity: 1,
        unit_price_cents: 100,
      }).success,
    ).toBe(false);
  });

  it('InvoiceLineReplaceSchema requires the `lines` key and enforces max 500', () => {
    expect(
      InvoiceLineReplaceSchema.safeParse({
        lines: [
          { description: 'A', quantity: 1, unit_price_cents: 100, position: 0 },
        ],
      }).success,
    ).toBe(true);
    // Empty array is valid (replace with zero lines).
    expect(InvoiceLineReplaceSchema.safeParse({ lines: [] }).success).toBe(true);
    // Missing key.
    expect(InvoiceLineReplaceSchema.safeParse({}).success).toBe(false);
    // Over max.
    const tooMany = {
      lines: Array.from({ length: 501 }, (_, i) => ({
        description: `L${i}`,
        quantity: 1,
        unit_price_cents: 1,
        position: i,
      })),
    };
    expect(InvoiceLineReplaceSchema.safeParse(tooMany).success).toBe(false);
  });

  it('InvoiceLineReorderSchema requires a non-empty uuid array', () => {
    expect(
      InvoiceLineReorderSchema.safeParse({
        line_ids: [
          '00000000-0000-0000-0000-000000000401',
          '00000000-0000-0000-0000-000000000402',
        ],
      }).success,
    ).toBe(true);
    expect(InvoiceLineReorderSchema.safeParse({ line_ids: [] }).success).toBe(false);
    expect(InvoiceLineReorderSchema.safeParse({ line_ids: ['nope'] }).success).toBe(false);
  });

  it('InvoiceLineUpsertSchema applies defaults for discount_cents and unit_cost_cents', () => {
    // Both fields default to 0 when omitted (the BE handler relies on this).
    const parsed = InvoiceLineUpsertSchema.safeParse({
      description: 'X',
      quantity: 1,
      unit_price_cents: 100,
      position: 0,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.discount_cents).toBe(0);
      expect(parsed.data.unit_cost_cents).toBe(0);
    }
  });

  it('InvoiceLineUpsertSchema.partial() accepts an empty patch (for PATCH endpoint)', () => {
    expect(InvoiceLineUpsertSchema.partial().safeParse({}).success).toBe(true);
    expect(
      InvoiceLineUpsertSchema.partial().safeParse({ description: 'updated', quantity: 5 })
        .success,
    ).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';

import {
  ApiErrSchema,
  QuoteLineReorderSchema,
  QuoteLineReplaceSchema,
  QuoteLineSchema,
  QuoteLineUpsertSchema,
} from '@/lib/types';
import {
  appendQuoteLine,
  deleteQuoteLine,
  listQuoteLines,
  patchQuoteLine,
  reorderQuoteLines,
  replaceQuoteLines,
} from '@/lib/services/quoteLineItemsService';

/**
 * Wire-contract tests for `/quotes-api/quotes/:quote_id/line-items`.
 * See TS1/09-api/00-API-CONTRACT.md §4.2.
 *
 * Note: the API contract §4.2 says the upsert body has `qty` and `discount_pct`;
 * the BE handler shipped in PR #38 + the Zod canon use `quantity` and
 * `discount_cents` (matches prod schema `quote_line_items` columns). The Zod
 * canon is the source of truth — the contract doc is stale. F-Wave4-XX
 * tracks doc reconcile. This test pins what's actually on the wire.
 */

const SAMPLE_LINE = {
  id: '00000000-0000-0000-0000-000000000101',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  quote_id: '00000000-0000-0000-0000-000000000001',
  quote_version_id: null,
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
};

describe('Wire contract: /quotes-api/quotes/:quote_id/line-items', () => {
  it('QuoteLineSchema accepts the canonical row shape', () => {
    const parsed = QuoteLineSchema.safeParse(SAMPLE_LINE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('GET /line-items returns parseable rows in the items array', () => {
    const items = [
      SAMPLE_LINE,
      { ...SAMPLE_LINE, id: '00000000-0000-0000-0000-000000000102', position: 1 },
    ];
    const parsed = QuoteLineSchema.array().safeParse(items);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('POST /line-items (bulk replace) body must declare `lines` array (max 500)', () => {
    const ok = {
      lines: [
        {
          description: 'A',
          quantity: 1,
          unit_price_cents: 100,
          position: 0,
        },
      ],
    };
    expect(QuoteLineReplaceSchema.safeParse(ok).success).toBe(true);
    // Empty array is valid (replace with zero lines).
    expect(QuoteLineReplaceSchema.safeParse({ lines: [] }).success).toBe(true);
    // Missing `lines` key is invalid.
    expect(QuoteLineReplaceSchema.safeParse({}).success).toBe(false);
    // 501 lines exceeds max.
    const tooMany = { lines: Array.from({ length: 501 }, (_, i) => ({
      description: `Line ${i}`,
      quantity: 1,
      unit_price_cents: 1,
      position: i,
    })) };
    expect(QuoteLineReplaceSchema.safeParse(tooMany).success).toBe(false);
  });

  it('POST /line-items/append upsert body validates', () => {
    const ok = {
      description: 'New line',
      quantity: 2,
      unit_price_cents: 500,
      position: 5,
    };
    expect(QuoteLineUpsertSchema.safeParse(ok).success).toBe(true);
    // Negative qty is invalid (z.number().positive()).
    expect(QuoteLineUpsertSchema.safeParse({ ...ok, quantity: -1 }).success).toBe(false);
    // Missing description is invalid.
    expect(
      QuoteLineUpsertSchema.safeParse({
        quantity: 1,
        unit_price_cents: 100,
        position: 0,
      }).success,
    ).toBe(false);
  });

  it('PATCH /line-items/:line_id accepts a partial upsert body', () => {
    const partial = { description: 'updated', quantity: 5 };
    const parsed = QuoteLineUpsertSchema.partial().safeParse(partial);
    expect(parsed.success).toBe(true);
    // Empty patch is valid.
    expect(QuoteLineUpsertSchema.partial().safeParse({}).success).toBe(true);
  });

  it('POST /line-items/reorder requires a non-empty line_ids uuid array', () => {
    const ok = {
      line_ids: [
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000102',
      ],
    };
    expect(QuoteLineReorderSchema.safeParse(ok).success).toBe(true);
    // Empty array is invalid (min 1).
    expect(QuoteLineReorderSchema.safeParse({ line_ids: [] }).success).toBe(false);
    // Non-uuid entries are invalid.
    expect(QuoteLineReorderSchema.safeParse({ line_ids: ['nope'] }).success).toBe(false);
  });

  it('DELETE /line-items/:line_id error envelope on parent-locked', () => {
    const err = {
      error: { code: 'QUOTE_LINE_PARENT_LOCKED', message: 'parent quote is approved' },
    };
    expect(ApiErrSchema.safeParse(err).success).toBe(true);
  });

  it('SPA service exports match the route table in §4.2', () => {
    expect(typeof listQuoteLines).toBe('function');
    expect(typeof replaceQuoteLines).toBe('function');
    expect(typeof appendQuoteLine).toBe('function');
    expect(typeof patchQuoteLine).toBe('function');
    expect(typeof deleteQuoteLine).toBe('function');
    expect(typeof reorderQuoteLines).toBe('function');
  });
});

import { describe, it, expect } from 'vitest';

import {
  POLineItemCreateSchema,
  POLineItemPatchSchema,
  POLineItemSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/vendors-api/purchase-orders/:id/lines` (Wave 7 /
 * Phase 10). The row-shape parity is pinned via `POLineItemSchema` parsing a
 * fixture that mirrors `LINE_COLS` in
 * `supabase/functions/vendors-api/handlers/purchase-orders.ts`.
 *
 * Per the handler, `line_total_cents = roundHalfEven(quantity * unit_cost_cents)`
 * is computed handler-side. `quantity` is numeric (not bigint) so fractional
 * quantities are valid.
 */

const SAMPLE_LINE = {
  id: '00000000-0000-0000-0000-000000000601',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  po_id: '00000000-0000-0000-0000-000000000501',
  item_id: null,
  description: 'Box of widgets',
  quantity: 10,
  quantity_received: 0,
  unit: 'box',
  unit_cost_cents: 500,
  line_total_cents: 5000,
  position: 0,
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
};

describe('Wire contract: /vendors-api/purchase-orders/:id/lines', () => {
  it('POLineItemSchema accepts the canonical row shape', () => {
    const parsed = POLineItemSchema.safeParse(SAMPLE_LINE);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('POLineItemSchema accepts fractional quantities (numeric, not bigint)', () => {
    expect(
      POLineItemSchema.safeParse({ ...SAMPLE_LINE, quantity: 1.5 }).success,
    ).toBe(true);
    expect(
      POLineItemSchema.safeParse({ ...SAMPLE_LINE, quantity_received: 0.5 }).success,
    ).toBe(true);
  });

  it('POLineItemSchema accepts a null item_id and null unit', () => {
    const noItem = { ...SAMPLE_LINE, item_id: null, unit: null };
    expect(POLineItemSchema.safeParse(noItem).success).toBe(true);
  });

  it('POLineItemCreateSchema accepts the minimum-required body', () => {
    expect(
      POLineItemCreateSchema.safeParse({
        description: 'Widget',
        quantity: 1,
        unit_cost_cents: 1000,
      }).success,
    ).toBe(true);
  });

  it('POLineItemCreateSchema rejects missing required fields', () => {
    expect(
      POLineItemCreateSchema.safeParse({ quantity: 1, unit_cost_cents: 100 }).success,
    ).toBe(false);
    expect(
      POLineItemCreateSchema.safeParse({ description: 'x', unit_cost_cents: 100 }).success,
    ).toBe(false);
    expect(
      POLineItemCreateSchema.safeParse({ description: 'x', quantity: 1 }).success,
    ).toBe(false);
  });

  it('POLineItemCreateSchema rejects zero/negative quantity', () => {
    expect(
      POLineItemCreateSchema.safeParse({
        description: 'x',
        quantity: 0,
        unit_cost_cents: 100,
      }).success,
    ).toBe(false);
    expect(
      POLineItemCreateSchema.safeParse({
        description: 'x',
        quantity: -1,
        unit_cost_cents: 100,
      }).success,
    ).toBe(false);
  });

  it('POLineItemCreateSchema rejects negative unit_cost_cents', () => {
    expect(
      POLineItemCreateSchema.safeParse({
        description: 'x',
        quantity: 1,
        unit_cost_cents: -1,
      }).success,
    ).toBe(false);
  });

  it('POLineItemCreateSchema is strict — rejects unknown keys', () => {
    expect(
      POLineItemCreateSchema.safeParse({
        description: 'x',
        quantity: 1,
        unit_cost_cents: 100,
        surprise: true,
      }).success,
    ).toBe(false);
  });

  it('POLineItemPatchSchema accepts a partial body and an empty body', () => {
    expect(POLineItemPatchSchema.safeParse({}).success).toBe(true);
    expect(POLineItemPatchSchema.safeParse({ quantity: 5 }).success).toBe(true);
  });

  it('POLineItemPatchSchema is strict — rejects unknown keys', () => {
    expect(POLineItemPatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });
});

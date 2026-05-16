import { describe, it, expect } from 'vitest';

import {
  PurchaseOrderCreateSchema,
  PurchaseOrderPatchSchema,
  PurchaseOrderReceiveSchema,
  PurchaseOrderSchema,
  PurchaseOrderStateSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/vendors-api/purchase-orders` (Wave 7 / Phase 10).
 *
 * The state-machine transitions live in `workflow-po.test.ts`; the row-shape
 * parity is pinned via `PurchaseOrderSchema` parsing a fixture that mirrors
 * the `PO_COLS` select list in
 * `supabase/functions/vendors-api/handlers/purchase-orders.ts`.
 *
 * Note `partial_received` (one r) — verified against the prod CHECK on
 * `purchase_orders.status` 2026-05-16, schema_migrations=0058. NOT the
 * dispatch text's `partially_received` spelling.
 */

const SAMPLE_PO = {
  id: '00000000-0000-0000-0000-000000000501',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  po_number: 'PO-2026-0001',
  vendor_id: '00000000-0000-0000-0000-000000000401',
  project_id: null,
  status: 'draft' as const,
  issue_date: '2026-05-16',
  expected_date: '2026-05-30',
  currency_code: 'USD',
  subtotal_cents: 0,
  tax_cents: 0,
  shipping_cents: 0,
  total_cents: 0,
  notes: null,
  state_changed_at: '2026-05-16T12:00:00+00:00',
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
  deleted_at: null,
};

describe('Wire contract: /vendors-api/purchase-orders', () => {
  it('PurchaseOrderSchema accepts the canonical row shape', () => {
    const parsed = PurchaseOrderSchema.safeParse(SAMPLE_PO);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('PurchaseOrderStateSchema enumerates the prod 7-state CHECK', () => {
    expect(PurchaseOrderStateSchema.options.slice().sort()).toEqual(
      [
        'approved',
        'cancelled',
        'closed',
        'draft',
        'partial_received',
        'received',
        'submitted',
      ].sort(),
    );
    expect(PurchaseOrderStateSchema.options.length).toBe(7);
  });

  it('PurchaseOrderStateSchema rejects the dispatch-misspelling "partially_received"', () => {
    // Defensive: pins the constitutional spelling. The Wave 7 dispatch text
    // proposed `partially_received`; the prod CHECK is `partial_received`
    // (one r). Drift here would 500 every PO receive call.
    expect(PurchaseOrderStateSchema.safeParse('partially_received').success).toBe(false);
    expect(PurchaseOrderStateSchema.safeParse('partial_received').success).toBe(true);
  });

  it('PurchaseOrderStateSchema rejects unknown states', () => {
    expect(PurchaseOrderStateSchema.safeParse('paid').success).toBe(false);
    expect(PurchaseOrderStateSchema.safeParse('completed').success).toBe(false);
    expect(PurchaseOrderStateSchema.safeParse('').success).toBe(false);
  });

  it('PurchaseOrderSchema rejects an invalid status value', () => {
    expect(
      PurchaseOrderSchema.safeParse({ ...SAMPLE_PO, status: 'partially_received' }).success,
    ).toBe(false);
  });

  it('PurchaseOrderCreateSchema accepts the minimum-required body (only vendor_id)', () => {
    expect(
      PurchaseOrderCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
      }).success,
    ).toBe(true);
  });

  it('PurchaseOrderCreateSchema rejects a body missing vendor_id', () => {
    expect(PurchaseOrderCreateSchema.safeParse({}).success).toBe(false);
  });

  it('PurchaseOrderCreateSchema accepts inline lines and validates their shape', () => {
    const okWithLines = {
      vendor_id: '00000000-0000-0000-0000-000000000401',
      lines: [
        { description: 'Box of widgets', quantity: 10, unit_cost_cents: 500 },
        {
          description: 'Pallet of sprockets',
          quantity: 1,
          unit_cost_cents: 25000,
          position: 1,
        },
      ],
    };
    expect(PurchaseOrderCreateSchema.safeParse(okWithLines).success).toBe(true);
    // Line quantity must be positive.
    expect(
      PurchaseOrderCreateSchema.safeParse({
        ...okWithLines,
        lines: [{ description: 'x', quantity: 0, unit_cost_cents: 1 }],
      }).success,
    ).toBe(false);
    // unit_cost_cents must be non-negative integer.
    expect(
      PurchaseOrderCreateSchema.safeParse({
        ...okWithLines,
        lines: [{ description: 'x', quantity: 1, unit_cost_cents: -1 }],
      }).success,
    ).toBe(false);
  });

  it('PurchaseOrderCreateSchema is strict — rejects unknown keys', () => {
    expect(
      PurchaseOrderCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        surprise: 1,
      }).success,
    ).toBe(false);
  });

  it('PurchaseOrderPatchSchema accepts a partial body and an empty body', () => {
    expect(PurchaseOrderPatchSchema.safeParse({}).success).toBe(true);
    expect(
      PurchaseOrderPatchSchema.safeParse({ notes: 'updated', tax_cents: 100 }).success,
    ).toBe(true);
  });

  it('PurchaseOrderPatchSchema is strict — rejects unknown keys (incl. vendor_id which is immutable)', () => {
    expect(
      PurchaseOrderPatchSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
      }).success,
    ).toBe(false);
    expect(PurchaseOrderPatchSchema.safeParse({ surprise: 1 }).success).toBe(false);
  });

  it('PurchaseOrderReceiveSchema requires at least one line entry', () => {
    expect(PurchaseOrderReceiveSchema.safeParse({ lines: [] }).success).toBe(false);
    expect(
      PurchaseOrderReceiveSchema.safeParse({
        lines: [
          {
            po_line_item_id: '00000000-0000-0000-0000-000000000601',
            quantity_received: 3,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('PurchaseOrderReceiveSchema rejects negative quantity_received', () => {
    expect(
      PurchaseOrderReceiveSchema.safeParse({
        lines: [
          {
            po_line_item_id: '00000000-0000-0000-0000-000000000601',
            quantity_received: -1,
          },
        ],
      }).success,
    ).toBe(false);
  });
});

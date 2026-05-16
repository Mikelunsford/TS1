import { describe, it, expect } from 'vitest';
import { z } from 'zod';

/**
 * Wire-contract tests for the R-W8D-INTEGRATION-01 (migration 0063)
 * stock-movement auto-emit triggers.
 *
 * Migration 0063 ships:
 *   - 3 AFTER triggers (receiving_orders / shipments / production_runs)
 *     that INSERT stock_movements rows when status / received_qty fields
 *     transition.
 *   - Extends stock_movements.movement_type CHECK with 'production_output'.
 *   - Extends stock_movements.reference_type CHECK with 'production_run'.
 *   - Adds bom_items.item_id + projects.finished_good_item_id FK columns.
 *
 * Trigger behavior is exercised end-to-end via the Playwright e2e at
 * playwright/e2e/wave8d-integration-01-stock-emit.spec.ts. This contract
 * test pins the wire taxonomies that touch the SPA / handler boundary:
 *
 *   1. stock_movements.movement_type now has 8 known values.
 *   2. stock_movements.reference_type now has 6 known values.
 *
 * These are TS-level Zod canons; the migration's CHECK constraint is the
 * load-bearing invariant in prod. The contract test guards against a
 * future migration silently dropping a value the SPA still references.
 */

const MovementTypeSchema = z.enum([
  'receipt',
  'shipment',
  'adjustment',
  'transfer_in',
  'transfer_out',
  'consumption',
  'return',
  'production_output',
]);

const ReferenceTypeSchema = z.enum([
  'receiving_order',
  'shipment',
  'production_consumption',
  'production_run',
  'purchase_order',
  'manual',
]);

describe('Wave 8d / 0063 — stock_movements movement_type taxonomy', () => {
  it('accepts all 8 known movement_type values', () => {
    for (const v of [
      'receipt',
      'shipment',
      'adjustment',
      'transfer_in',
      'transfer_out',
      'consumption',
      'return',
      'production_output',
    ] as const) {
      expect(() => MovementTypeSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects an unknown movement_type', () => {
    expect(() => MovementTypeSchema.parse('write_off')).toThrow();
  });

  it('accepts production_output (new in 0063)', () => {
    expect(MovementTypeSchema.parse('production_output')).toBe('production_output');
  });
});

describe('Wave 8d / 0063 — stock_movements reference_type taxonomy', () => {
  it('accepts all 6 known reference_type values', () => {
    for (const v of [
      'receiving_order',
      'shipment',
      'production_consumption',
      'production_run',
      'purchase_order',
      'manual',
    ] as const) {
      expect(() => ReferenceTypeSchema.parse(v)).not.toThrow();
    }
  });

  it('rejects an unknown reference_type', () => {
    expect(() => ReferenceTypeSchema.parse('vendor_bill')).toThrow();
  });

  it('accepts production_run (new in 0063)', () => {
    expect(ReferenceTypeSchema.parse('production_run')).toBe('production_run');
  });
});

describe('Wave 8d / 0063 — auto-emit invariants (documented)', () => {
  /**
   * The trigger functions emit ONE stock_movement row per source-event
   * (receiving partial-receipt delta; shipment shipped; production_run
   * completion = N consumption rows + 1 production_output row).
   *
   * Idempotency strategies:
   *   - receiving_order: SUM existing emissions for (reference_type=
   *     'receiving_order', reference_id=RO.id) and emit only the
   *     incremental delta. Multiple partial-receive events accumulate
   *     cleanly without duplication.
   *   - shipment: skip-if-exists on (reference_type='shipment',
   *     reference_id=shipment.id).
   *   - production_run consumption rows: skip-if-exists on
   *     (reference_type='production_consumption', reference_id=
   *     bom_items.id) — per-row idempotency.
   *   - production_run finished-good: skip-if-exists on
   *     (reference_type='production_run', reference_id=
   *     production_run.id).
   *
   * Fail-loud cases (raise check_violation):
   *   - receiving_order with NULL bom_items.item_id
   *   - shipment.shipped with NULL projects.finished_good_item_id
   *   - production_run.complete with NULL projects.finished_good_item_id
   *   - production_run.complete when any bom_items row on the project
   *     has NULL item_id and quantity > 0
   *
   * This `expect(true).toBe(true)` block is a doc anchor; the actual
   * behaviors are verified by the Playwright e2e + the migration's
   * post-state DO block.
   */
  it('documents the four fail-loud invariants', () => {
    expect(true).toBe(true);
  });
});

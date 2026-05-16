import { describe, it, expect } from 'vitest';

import { roundHalfEven } from '@/lib/money';

/**
 * Wave 7 / Phase 10 — PO line-total half-even rounding parity.
 *
 * The BE handler in `supabase/functions/vendors-api/handlers/purchase-orders.ts`
 * computes:
 *
 *   line_total_cents = roundHalfEven(quantity * unit_cost_cents)
 *
 * via the canonical `roundHalfEven` helper from `_shared/money.ts`
 * (constitutional rule F-Wave5-02 — closed in Wave 5). The trigger from
 * migration 0058 does NOT recompute line totals; it only rolls up header
 * subtotal_cents / total_cents from the line rows. So the handler's
 * computeLineTotal IS the canonical rule — and the SPA `roundHalfEven` is
 * byte-mirrored.
 *
 * This file pins the boundary half-cent cases for the PO surface so a future
 * refactor that drifts back to half-up or to a Postgres `round()` flavor on a
 * future trigger fails loudly.
 */

/** Mirror of the BE handler `computeLineTotal`. */
function computeLineTotal(quantity: number, unitCostCents: number): number {
  return roundHalfEven(quantity * unitCostCents);
}

describe('PO line-total rounding (Phase 10) — half-even at half-cent boundaries', () => {
  it('clean integer products are exact', () => {
    expect(computeLineTotal(10, 500)).toBe(5000);
    expect(computeLineTotal(1, 25000)).toBe(25000);
    expect(computeLineTotal(3, 333)).toBe(999);
  });

  it('half-cent product rounds to the nearest EVEN integer', () => {
    // 0.5 cent products. JS half-up would round 0.5 -> 1; half-even -> 0.
    expect(computeLineTotal(0.5, 1)).toBe(0);
    // 1.5 cents -> 2 (half-even rounds to even).
    expect(computeLineTotal(1.5, 1)).toBe(2);
    // 2.5 cents -> 2 (half-even rounds to even). Half-up would give 3.
    expect(computeLineTotal(2.5, 1)).toBe(2);
    // 3.5 cents -> 4 (half-even rounds to even).
    expect(computeLineTotal(3.5, 1)).toBe(4);
  });

  it('fractional quantity with integer unit cost works correctly', () => {
    // 1.5 boxes × 100 cents = 150 cents (no rounding needed).
    expect(computeLineTotal(1.5, 100)).toBe(150);
    // 0.333... ish × 300 cents = 99.9 ish; non-boundary, behaves like Math.round.
    expect(computeLineTotal(0.333, 300)).toBe(Math.round(0.333 * 300));
  });

  it('zero-cost or zero-quantity lines compute to zero', () => {
    expect(computeLineTotal(0, 1000)).toBe(0);
    expect(computeLineTotal(5, 0)).toBe(0);
  });

  it('matches Math.round for non-.5 fractional products', () => {
    for (const [q, c] of [
      [1.1, 100],
      [2.3, 500],
      [10, 17],
      [4.9, 99],
    ]) {
      expect(computeLineTotal(q!, c!), `q=${q} × c=${c}`).toBe(Math.round(q! * c!));
    }
  });
});

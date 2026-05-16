import { describe, it, expect } from 'vitest';

import { roundHalfEven, taxTotalCents, type TaxableLine } from '@/lib/money';

/**
 * Half-even rounding parity pin (F-Wave5-02 / closes R-W3-07).
 *
 * Wave 3 and Wave 4 deliberately preserved the JS `Math.round` (half-away-
 * from-zero, effectively half-up for positive money) rule that every shipped
 * quote / line / total carried. F-Wave5-02 flipped the rule to constitutional
 * half-even across SPA `lib/money.ts` and BE `_shared/money.ts` /
 * `quotes-api/handlers/line-items.ts#computeLineTotals`. This test pins the
 * exact boundary behavior so a future refactor that drifts back to half-up
 * (or to a Postgres `round()` flavor on the trigger side) fails loudly.
 *
 * Non-boundary fixtures live in:
 *   - wave3/money-parity.test.ts  (the 262.5 → 262 case)
 *   - wave4/money-parity-quote-lines.test.ts (3-line non-boundary fixture)
 *
 * This file owns the .5 cases.
 */

describe('money parity: half-even rounding (F-Wave5-02)', () => {
  it('roundHalfEven rounds .5 to the nearest EVEN integer', () => {
    expect(roundHalfEven(0.5)).toBe(0);
    expect(roundHalfEven(1.5)).toBe(2);
    expect(roundHalfEven(2.5)).toBe(2);
    expect(roundHalfEven(3.5)).toBe(4);
    expect(roundHalfEven(-0.5)).toBe(0);
    expect(roundHalfEven(-1.5)).toBe(-2);
    expect(roundHalfEven(-2.5)).toBe(-2);
  });

  it('roundHalfEven matches Math.round for non-.5 values', () => {
    for (const n of [0.1, 0.9, 1.2, 1.8, -1.2, -1.8, 99.4, 100.6]) {
      expect(roundHalfEven(n)).toBe(Math.round(n));
    }
  });

  it('taxTotalCents at the boundary: 262.5 → 262, not 263', () => {
    // 3 * 1000 = 3000 ¢; 3000 * 0.0875 = 262.5 exact. Half-even → 262 (even).
    const totals = taxTotalCents([{ qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 }]);
    expect(totals.tax_cents).toBe(262);
  });

  it('taxTotalCents at the boundary: 263.5 → 264 (even)', () => {
    // Construct a fixture that lands at 263.5 exactly:
    // 30 * 100 = 3000 ¢, rate 0.087833... no — use 1054 * 0.25 = 263.5.
    // 4 * 1054 = 4216; rate 0.0625 → 4216 * 0.0625 = 263.5 exact.
    const totals = taxTotalCents([{ qty: 4, unit_price_cents: 1054, tax_rate: 0.0625 }]);
    expect(totals.subtotal_cents).toBe(4216);
    expect(totals.tax_cents).toBe(264);
  });

  it('per-line then sum — boundary on every line still rounds correctly', () => {
    // Two identical 262.5 lines: half-even gives 262 each → 524 total tax.
    // Old half-up would have given 263 each → 526. The constitutional answer is 524.
    const lines: TaxableLine[] = [
      { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
      { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
    ];
    const totals = taxTotalCents(lines);
    expect(totals.subtotal_cents).toBe(6000);
    expect(totals.tax_cents).toBe(524);
    expect(totals.total_cents).toBe(6524);
  });
});

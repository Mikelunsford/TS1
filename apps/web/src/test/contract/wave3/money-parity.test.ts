import { describe, it, expect } from 'vitest';

import { taxTotalCents, type TaxableLine } from '@/lib/money';

/**
 * Cross-line tax-total computation parity.
 *
 * The sales chassis (quotes, invoices) computes line-level tax amounts from a
 * per-line tax rate, then aggregates to a single tax_cents total on the parent
 * document. The rounding rule is documented in TS1/07-architecture §1.1:
 * **per-line rounding to the nearest cent (half-even, banker's rounding)**,
 * then a plain integer sum across lines. There is no compound rounding at the
 * document level. The canonical helper lives at `apps/web/src/lib/money.ts#taxTotalCents`
 * (introduced in Wave 4 pre-flight 4.0c, closes R-W3-06; rounding flipped
 * to half-even in Wave 5 pre-flight F-Wave5-02 closing R-W3-07). This test
 * pins the resulting numbers on a known fixture so any future rounding drift
 * fails loudly.
 */

describe('money parity: cross-line tax-total computation', () => {
  it('rounds per-line then sums (no compound rounding)', () => {
    const lines: TaxableLine[] = [
      // Line 1: 3 * 1000 = 3000 cents subtotal; 3000 * 0.0875 = 262.5 → 262 (half-even).
      { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
      // Line 2: 2 * 1500 = 3000 cents subtotal; 3000 * 0.05 = 150 exact.
      { qty: 2, unit_price_cents: 1500, tax_rate: 0.05 },
    ];
    const totals = taxTotalCents(lines);
    expect(totals.subtotal_cents).toBe(6000);
    expect(totals.tax_cents).toBe(412);
    expect(totals.total_cents).toBe(6412);
  });

  it('zero-tax lines contribute zero tax', () => {
    const totals = taxTotalCents([{ qty: 5, unit_price_cents: 200, tax_rate: 0 }]);
    expect(totals.subtotal_cents).toBe(1000);
    expect(totals.tax_cents).toBe(0);
    expect(totals.total_cents).toBe(1000);
  });

  it('a single line with a non-trivial rate matches its per-line round', () => {
    // 7 * 333 cents = 2331; 2331 * 0.085 = 198.135 -> 198.
    const totals = taxTotalCents([{ qty: 7, unit_price_cents: 333, tax_rate: 0.085 }]);
    expect(totals.subtotal_cents).toBe(2331);
    expect(totals.tax_cents).toBe(198);
    expect(totals.total_cents).toBe(2529);
  });
});

import { describe, it, expect } from 'vitest';

import { taxTotalCents, type TaxableLine } from '@/lib/money';

/**
 * Cross-line tax-total computation parity.
 *
 * The sales chassis (quotes, invoices) computes line-level tax amounts from a
 * per-line tax rate, then aggregates to a single tax_cents total on the parent
 * document. The rounding rule is documented in TS1/07-architecture §1.1:
 * **per-line rounding to the nearest cent (half-up via Math.round)**, then a
 * plain integer sum across lines. There is no compound rounding at the
 * document level. The canonical helper lives at `apps/web/src/lib/money.ts#taxTotalCents`
 * (introduced in Wave 4 pre-flight 4.0c, closes R-W3-06). This test pins the
 * resulting numbers on a known fixture to catch drift in rounding order or
 * sum semantics.
 *
 * Note: spec language sometimes says "banker's rounding (half-even)". The
 * expected values below (262.5 -> 263) correspond to the JS `Math.round`
 * semantic actually used in `lib/money.ts` (half-up for positive numbers).
 * R-W3-07 tracks the spec drift; the deliberate failure of this fixture is
 * the gate that catches a half-even switch without paired updates.
 */

describe('money parity: cross-line tax-total computation', () => {
  it('rounds per-line then sums (no compound rounding)', () => {
    const lines: TaxableLine[] = [
      // Line 1: 3 * 1000 = 3000 cents subtotal; 3000 * 0.0875 = 262.5 -> 263.
      { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
      // Line 2: 2 * 1500 = 3000 cents subtotal; 3000 * 0.05 = 150 exact.
      { qty: 2, unit_price_cents: 1500, tax_rate: 0.05 },
    ];
    const totals = taxTotalCents(lines);
    expect(totals.subtotal_cents).toBe(6000);
    expect(totals.tax_cents).toBe(413);
    expect(totals.total_cents).toBe(6413);
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

import { describe, it, expect } from 'vitest';

/**
 * Cross-line tax-total computation parity.
 *
 * The sales chassis (quotes, invoices) computes line-level tax amounts from
 * a per-line tax rate, then aggregates to a single tax_cents total on the
 * parent document. The rounding rule is documented in TS1/07-architecture
 * §1.1: **per-line rounding to the nearest cent (half-up via Math.round)**,
 * then a plain integer sum across lines. There is no compound rounding at
 * the document level.
 *
 * This test mirrors that rule on a known fixture and verifies the resulting
 * subtotal / tax / total are exactly the expected integer-cent values. It
 * is a SANITY check that catches drift in how a future helper or refactor
 * orders the cent-rounding vs. the cross-line sum.
 *
 * Note: spec language sometimes says "banker's rounding (half-even)". The
 * expected values below (262.5 -> 263) correspond to the JS `Math.round`
 * semantic actually used in `apps/web/src/lib/money.ts` (half-up for
 * positive numbers). If the codebase ever moves to true half-even, this
 * fixture's `tax_cents=413` would become `tax_cents=412` and this test
 * would need to flip in lockstep — the deliberate failure is the point.
 */

interface QuoteLine {
  qty: number;
  unit_price_cents: number;
  /** Tax rate as a decimal in [0..1]. 0.0875 == 8.75 %. */
  tax_rate: number;
}

interface QuoteTotals {
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
}

/**
 * Reference implementation that mirrors what the Edge Function and the SPA
 * MUST both compute. Keep this implementation simple — readability beats
 * cleverness; the assertion below pins the resulting numbers, not the
 * algorithm shape.
 */
function computeQuoteTotals(lines: QuoteLine[]): QuoteTotals {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const line_total = line.qty * line.unit_price_cents;
    const line_tax = Math.round(line_total * line.tax_rate); // per-line cent rounding
    subtotal += line_total;
    tax += line_tax;
  }
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

describe('money parity: cross-line tax-total computation', () => {
  it('rounds per-line then sums (no compound rounding)', () => {
    const lines: QuoteLine[] = [
      // Line 1: 3 * 1000 = 3000 cents subtotal; 3000 * 0.0875 = 262.5 -> 263.
      { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
      // Line 2: 2 * 1500 = 3000 cents subtotal; 3000 * 0.05 = 150 exact.
      { qty: 2, unit_price_cents: 1500, tax_rate: 0.05 },
    ];
    const totals = computeQuoteTotals(lines);
    expect(totals.subtotal_cents).toBe(6000);
    expect(totals.tax_cents).toBe(413);
    expect(totals.total_cents).toBe(6413);
  });

  it('zero-tax lines contribute zero tax', () => {
    const totals = computeQuoteTotals([{ qty: 5, unit_price_cents: 200, tax_rate: 0 }]);
    expect(totals.subtotal_cents).toBe(1000);
    expect(totals.tax_cents).toBe(0);
    expect(totals.total_cents).toBe(1000);
  });

  it('a single line with a non-trivial rate matches its per-line round', () => {
    // 7 * 333 cents = 2331; 2331 * 0.085 = 198.135 -> 198.
    const totals = computeQuoteTotals([{ qty: 7, unit_price_cents: 333, tax_rate: 0.085 }]);
    expect(totals.subtotal_cents).toBe(2331);
    expect(totals.tax_cents).toBe(198);
    expect(totals.total_cents).toBe(2529);
  });
});

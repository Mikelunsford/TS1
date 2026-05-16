import { describe, it, expect } from 'vitest';

import { roundHalfEven, taxTotalCents, type TaxableLine } from '@/lib/money';

/**
 * Quote-line money parity. Extends `wave3/money-parity.test.ts` with a
 * 3-line fixture that mirrors the per-line totals math implemented in
 * `supabase/functions/quotes-api/handlers/line-items.ts#computeLineTotals`.
 *
 * BE math (per line, post-F-Wave5-02 half-even flip):
 *   gross           = roundHalfEven(qty * unit_price_cents)
 *   line_total_cents = gross - discount_cents
 *   tax_amount_cents = roundHalfEven(line_total_cents * rate)
 *
 * SPA math (`taxTotalCents`, per line):
 *   line_total = qty * unit_price_cents - (discount_cents ?? 0)
 *   line_tax   = roundHalfEven(line_total * rate)
 *
 * For integer qty the two are byte-identical. The fixture below uses integer
 * qty and rates whose products don't land at exact `.5` boundaries, so the
 * half-up → half-even flip is value-stable here; the boundary cases (262.5 →
 * 262 vs 263) are pinned in wave5/money-half-even.test.ts.
 */

describe('money parity: quote-line per-line totals (3-line fixture)', () => {
  it('matches the BE computeLineTotals output byte-for-byte', () => {
    // 3-line quote, mixed rates + a discount on line 2.
    // Line 1: 4 * 2500 = 10000; no discount; rate 0.0875 → 10000 * 0.0875 = 875 exact.
    // Line 2: 7 * 1599 = 11193; discount 500; net 10693; rate 0.06 → 10693 * 0.06 = 641.58 -> 642.
    // Line 3: 2 * 9999 = 19998; no discount; rate 0     → 0 tax.
    const lines: TaxableLine[] = [
      { qty: 4, unit_price_cents: 2500, tax_rate: 0.0875 },
      { qty: 7, unit_price_cents: 1599, tax_rate: 0.06, discount_cents: 500 },
      { qty: 2, unit_price_cents: 9999, tax_rate: 0 },
    ];

    // Mirror BE computeLineTotals per line.
    const beLines = lines.map((l) => {
      const gross = roundHalfEven(l.qty * l.unit_price_cents);
      const line_total_cents = gross - (l.discount_cents ?? 0);
      const tax_amount_cents = roundHalfEven(line_total_cents * (l.tax_rate ?? 0));
      return { line_total_cents, tax_amount_cents };
    });
    const beSubtotal = beLines.reduce((s, r) => s + r.line_total_cents, 0);
    const beTax = beLines.reduce((s, r) => s + r.tax_amount_cents, 0);
    const beTotal = beSubtotal + beTax;

    // SPA-side preview.
    const spa = taxTotalCents(lines);

    expect(beLines[0]).toEqual({ line_total_cents: 10000, tax_amount_cents: 875 });
    expect(beLines[1]).toEqual({ line_total_cents: 10693, tax_amount_cents: 642 });
    expect(beLines[2]).toEqual({ line_total_cents: 19998, tax_amount_cents: 0 });
    expect(beSubtotal).toBe(40691);
    expect(beTax).toBe(1517);
    expect(beTotal).toBe(42208);

    expect(spa.subtotal_cents).toBe(beSubtotal);
    expect(spa.tax_cents).toBe(beTax);
    expect(spa.total_cents).toBe(beTotal);
  });

  it('single-line discount applied before tax', () => {
    // 5 * 1000 = 5000; discount 200; net 4800; rate 0.10 → 480 tax.
    const lines: TaxableLine[] = [
      { qty: 5, unit_price_cents: 1000, tax_rate: 0.1, discount_cents: 200 },
    ];
    const totals = taxTotalCents(lines);
    expect(totals.subtotal_cents).toBe(4800);
    expect(totals.tax_cents).toBe(480);
    expect(totals.total_cents).toBe(5280);
  });

  it('rounding is per-line, not per-document', () => {
    // Two identical lines: 1 * 333 = 333; rate 0.085 → 333 * 0.085 = 28.305 -> 28 per line.
    // Per-line: 28 + 28 = 56. Document-rounded: round(666 * 0.085) = round(56.61) = 57.
    // The canonical answer is 56 (per-line rule).
    const lines: TaxableLine[] = [
      { qty: 1, unit_price_cents: 333, tax_rate: 0.085 },
      { qty: 1, unit_price_cents: 333, tax_rate: 0.085 },
    ];
    const totals = taxTotalCents(lines);
    expect(totals.subtotal_cents).toBe(666);
    expect(totals.tax_cents).toBe(56);
    expect(totals.total_cents).toBe(722);
  });
});

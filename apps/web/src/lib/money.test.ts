import { describe, it, expect } from 'vitest';

import { toCents, fromCents, formatMoney, taxTotalCents } from './money';

describe('money', () => {
  describe('toCents', () => {
    it('converts a plain number', () => {
      expect(toCents(12.34)).toBe(1234);
    });
    it('rounds half-up at the cent boundary', () => {
      expect(toCents(0.005)).toBe(1);
      expect(toCents(0.015)).toBe(2);
    });
    it('strips currency symbols and grouping', () => {
      expect(toCents('$1,234.56')).toBe(123456);
      expect(toCents('1,234.56')).toBe(123456);
    });
    it('throws on garbage input', () => {
      expect(() => toCents('abc')).toThrow();
    });
  });

  describe('fromCents', () => {
    it('round-trips with toCents', () => {
      expect(fromCents(toCents(99.99))).toBeCloseTo(99.99, 2);
    });
    it('accepts bigint', () => {
      expect(fromCents(12345n)).toBeCloseTo(123.45, 2);
    });
  });

  describe('formatMoney', () => {
    it('formats USD with two decimals by default', () => {
      expect(formatMoney(123456)).toContain('1,234.56');
    });
    it('formats JPY with zero decimals', () => {
      const out = formatMoney(1234, { currency: 'JPY', locale: 'en-US' });
      expect(out).toContain('1,234');
      expect(out).not.toContain('.');
    });
    it('returns em-dash for non-finite input', () => {
      expect(formatMoney(Number.NaN)).toBe('—');
    });
  });

  describe('taxTotalCents', () => {
    it('rounds per-line at the cent boundary then sums (no compound rounding)', () => {
      // Line 1: 3 * 1000 = 3000 ¢; 3000 * 0.0875 = 262.5 -> 263 (half-up).
      // Line 2: 2 * 1500 = 3000 ¢; 3000 * 0.05 = 150 exact.
      const totals = taxTotalCents([
        { qty: 3, unit_price_cents: 1000, tax_rate: 0.0875 },
        { qty: 2, unit_price_cents: 1500, tax_rate: 0.05 },
      ]);
      expect(totals.subtotal_cents).toBe(6000);
      expect(totals.tax_cents).toBe(413);
      expect(totals.total_cents).toBe(6413);
    });

    it('treats missing tax_rate as zero', () => {
      const totals = taxTotalCents([{ qty: 5, unit_price_cents: 200 }]);
      expect(totals.subtotal_cents).toBe(1000);
      expect(totals.tax_cents).toBe(0);
      expect(totals.total_cents).toBe(1000);
    });

    it('applies per-line discount before tax', () => {
      // 4 * 1250 = 5000 ¢ - 500 discount = 4500 ¢; 4500 * 0.10 = 450 exact.
      const totals = taxTotalCents([
        { qty: 4, unit_price_cents: 1250, tax_rate: 0.1, discount_cents: 500 },
      ]);
      expect(totals.subtotal_cents).toBe(4500);
      expect(totals.tax_cents).toBe(450);
      expect(totals.total_cents).toBe(4950);
    });

    it('handles a single line with a non-trivial rate', () => {
      // 7 * 333 = 2331 ¢; 2331 * 0.085 = 198.135 -> 198.
      const totals = taxTotalCents([{ qty: 7, unit_price_cents: 333, tax_rate: 0.085 }]);
      expect(totals.subtotal_cents).toBe(2331);
      expect(totals.tax_cents).toBe(198);
      expect(totals.total_cents).toBe(2529);
    });
  });
});

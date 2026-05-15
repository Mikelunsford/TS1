import { describe, it, expect } from 'vitest';

import { toCents, fromCents, formatMoney } from './money';

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
});

import { describe, expect, it } from 'vitest';

import {
  CurrencyPatchSchema,
  CurrencyUpsertSchema,
  ExchangeRateInsertSchema,
  PaymentMethodCreateSchema,
  PaymentMethodPatchSchema,
  TaxCreateSchema,
  TaxPatchSchema,
} from './types';

/**
 * Unit coverage for the Wave-3 finance Zod schemas. The contract parity
 * test already enforces structural equality between this file and the
 * _shared mirror; these tests pin the semantics callers depend on
 * (defaults, required fields, range rejection).
 */

describe('CurrencyUpsertSchema', () => {
  it('accepts a minimal currency upsert', () => {
    const parsed = CurrencyUpsertSchema.parse({
      code: 'USD',
      label: 'US Dollar',
      symbol: '$',
    });
    expect(parsed.code).toBe('USD');
    expect(parsed.symbol_position).toBe('before');
    expect(parsed.decimal_sep).toBe('.');
    expect(parsed.cent_precision).toBe(2);
    expect(parsed.is_active).toBe(true);
  });

  it('rejects a 2-letter code', () => {
    expect(() =>
      CurrencyUpsertSchema.parse({ code: 'US', label: 'X', symbol: '$' }),
    ).toThrow();
  });

  it('rejects a negative cent_precision', () => {
    expect(() =>
      CurrencyUpsertSchema.parse({
        code: 'USD',
        label: 'X',
        symbol: '$',
        cent_precision: -1,
      }),
    ).toThrow();
  });
});

describe('CurrencyPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => CurrencyPatchSchema.parse({})).not.toThrow();
  });

  it('does not accept a code key', () => {
    const parsed = CurrencyPatchSchema.parse({ code: 'XXX', label: 'New' } as never);
    // `code` is omitted from CurrencyPatchSchema; Zod silently drops unknown keys.
    expect((parsed as Record<string, unknown>).code).toBeUndefined();
    expect(parsed.label).toBe('New');
  });
});

describe('ExchangeRateInsertSchema', () => {
  it('accepts a valid rate', () => {
    const parsed = ExchangeRateInsertSchema.parse({
      base_code: 'USD',
      quote_code: 'EUR',
      rate: 0.91,
      as_of: '2026-05-15',
    });
    expect(parsed.source).toBe('manual');
  });

  it('rejects non-positive rate', () => {
    expect(() =>
      ExchangeRateInsertSchema.parse({
        base_code: 'USD',
        quote_code: 'EUR',
        rate: 0,
        as_of: '2026-05-15',
      }),
    ).toThrow();
  });

  it('rejects bad date format', () => {
    expect(() =>
      ExchangeRateInsertSchema.parse({
        base_code: 'USD',
        quote_code: 'EUR',
        rate: 0.91,
        as_of: '05/15/2026',
      }),
    ).toThrow();
  });
});

describe('TaxCreateSchema', () => {
  it('accepts a minimal tax', () => {
    const parsed = TaxCreateSchema.parse({ code: 'NY-SALES', label: 'NY Sales Tax', rate: 0.0875 });
    expect(parsed.is_compound).toBe(false);
    expect(parsed.is_inclusive).toBe(false);
    expect(parsed.is_default).toBe(false);
    expect(parsed.is_active).toBe(true);
  });

  it('rejects rate > 1 (would be basis-points-ish)', () => {
    expect(() =>
      TaxCreateSchema.parse({ code: 'X', label: 'Y', rate: 8.75 }),
    ).toThrow();
  });

  it('rejects negative rate', () => {
    expect(() =>
      TaxCreateSchema.parse({ code: 'X', label: 'Y', rate: -0.1 }),
    ).toThrow();
  });

  it('accepts rate=0 (zero-rated tax)', () => {
    const parsed = TaxCreateSchema.parse({ code: 'ZERO', label: 'Zero', rate: 0 });
    expect(parsed.rate).toBe(0);
  });
});

describe('TaxPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => TaxPatchSchema.parse({})).not.toThrow();
  });

  it('rejects out-of-range rate even in patch', () => {
    expect(() => TaxPatchSchema.parse({ rate: 1.5 })).toThrow();
  });
});

describe('PaymentMethodCreateSchema', () => {
  it('accepts a minimal payment method', () => {
    const parsed = PaymentMethodCreateSchema.parse({ code: 'cash', label: 'Cash' });
    expect(parsed.is_default).toBe(false);
    expect(parsed.is_active).toBe(true);
  });

  it('requires code and label', () => {
    expect(() => PaymentMethodCreateSchema.parse({ code: '' })).toThrow();
    expect(() => PaymentMethodCreateSchema.parse({ label: 'x' })).toThrow();
  });
});

describe('PaymentMethodPatchSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => PaymentMethodPatchSchema.parse({})).not.toThrow();
  });
});

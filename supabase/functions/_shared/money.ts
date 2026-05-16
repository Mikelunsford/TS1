/**
 * Money helpers — Deno mirror of apps/web/src/lib/money.ts.
 *
 * Constitutional invariants (TS1/03-workspace/00-SHARED-CONTEXT.md "Money Model"):
 *  - Money is integer cents on the wire and in the DB (bigint columns).
 *  - Floats are NEVER used for money math.
 *  - This module is the ONLY converter between display strings and cents.
 *
 * Kept hand-mirrored from the SPA file. The contract test
 * `money.parity.test.ts` (Wave 1+) will assert that the helper signatures
 * agree byte-for-byte. Wave 0 keeps the surface aligned even though the
 * parity test does not yet block CI for this file.
 */

export type Cents = number;

/** Parse a user-facing money string ("$1,234.56", "1234.56", "1,234.56") into cents. */
export function toCents(input: string | number, decimals = 2): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('toCents: non-finite number');
    return Math.round(input * 10 ** decimals);
  }
  const cleaned = input.replace(/[^\d.\-]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') {
    throw new Error(`toCents: not a number: ${input}`);
  }
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) throw new Error(`toCents: not a number: ${input}`);
  return Math.round(n * 10 ** decimals);
}

/** Convert cents back to a major-unit number for display only. NEVER for math. */
export function fromCents(cents: Cents | string | bigint, decimals = 2): number {
  const n = typeof cents === 'bigint' ? Number(cents) : Number(cents);
  if (!Number.isFinite(n)) throw new Error('fromCents: invalid input');
  return n / 10 ** decimals;
}

interface FormatOptions {
  currency?: string; // ISO 4217, default USD
  locale?: string; // BCP 47, default en-US
  showSymbol?: boolean;
}

/**
 * Half-even (banker's) rounding on the final cent. Constitutional rule
 * (TS1/03-workspace/00-SHARED-CONTEXT.md "Money Model"). F-Wave5-02 closed
 * R-W3-07 by flipping per-line tax rounding from `Math.round` (half-up) to
 * this helper in both BE handlers and the SPA preview, paired with the
 * money-parity fixture rewrite. Identical to Math.round for non-`.5` values.
 */
export function roundHalfEven(n: number): number {
  if (!Number.isFinite(n)) return n;
  const floor = Math.floor(n);
  const diff = n - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
function getFractionDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

/**
 * Format cents for display. Server-side rendering (PDF, email body) goes
 * through this helper too; the SPA copy is identical.
 */
export function formatMoney(cents: Cents | string | bigint, opts: FormatOptions = {}): string {
  const { currency = 'USD', locale = 'en-US', showSymbol = true } = opts;
  const n = typeof cents === 'bigint' ? Number(cents) : Number(cents);
  if (!Number.isFinite(n)) return '—';

  const fmt = new Intl.NumberFormat(locale, {
    style: showSymbol ? 'currency' : 'decimal',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fractionDigits = getFractionDigits(currency);
  const value = n / 10 ** fractionDigits;
  return fmt.format(value);
}

export {};

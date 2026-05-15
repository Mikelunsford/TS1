/**
 * Money is integer cents end-to-end. This module is the ONLY converter.
 *
 * See TS1/03-workspace/00-SHARED-CONTEXT.md and
 *     TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §1.1.
 *
 * Invariants:
 *  - DB columns are `bigint` storing cents.
 *  - Wire format JSON carries cents as a JS number when safely under
 *    Number.MAX_SAFE_INTEGER; otherwise as a string. Both forms decode here.
 *  - Floats are NEVER used for money math. Anywhere you see `n.toFixed(2)`
 *    in this codebase, it is a bug. Use formatMoney.
 */

export type Cents = number;

/** Parse a user-facing money string ("$1,234.56", "1234.56", "1,234.56") into cents. */
export function toCents(input: string | number, decimals = 2): Cents {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new Error('toCents: non-finite number');
    return Math.round(input * 10 ** decimals);
  }
  const cleaned = input.replace(/[^\d.-]/g, '');
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
 * Format cents for display using `Intl.NumberFormat`. The currency's standard
 * fractional digits are used (USD: 2, JPY: 0, etc.).
 */
export function formatMoney(cents: Cents | string | bigint, opts: FormatOptions = {}): string {
  const { currency = 'USD', locale = 'en-US', showSymbol = true } = opts;
  const n = typeof cents === 'bigint' ? Number(cents) : Number(cents);
  if (!Number.isFinite(n)) return '—';

  const fractionDigits = getFractionDigits(currency);
  const fmt = new Intl.NumberFormat(locale, {
    style: showSymbol ? 'currency' : 'decimal',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });

  const value = n / 10 ** fractionDigits;
  return fmt.format(value);
}

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);
function getFractionDigits(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

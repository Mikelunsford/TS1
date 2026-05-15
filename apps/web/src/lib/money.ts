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

/**
 * One taxable line on a quote / invoice / credit note.
 *
 * - `tax_rate` is a decimal fraction in [0, 1] (e.g. 0.0875 for 8.75 %).
 *   This is the shape `taxes.rate numeric(7,6)` snapshots into
 *   `quote_line_items.tax_rate_snapshot` at issue time (TS1/09-api §7.1
 *   post-Wave-4-4.0a, schema master §6.5 + §10.3).
 * - `discount_cents` is applied before tax (matches the trigger math the
 *   Phase 7 invoice triggers will install in `0033_sales.sql`).
 */
export interface TaxableLine {
  qty: number;
  unit_price_cents: Cents;
  /** Decimal in [0, 1]. Defaults to 0. */
  tax_rate?: number;
  /** Per-line discount applied before tax. Defaults to 0. */
  discount_cents?: Cents;
}

export interface TaxedTotalsCents {
  subtotal_cents: Cents;
  tax_cents: Cents;
  total_cents: Cents;
}

/**
 * Cross-line tax-total computation.
 *
 * Rule (TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §1.1, R-W3-07-pending):
 *   1. For each line, `line_total = qty * unit_price_cents - discount_cents`.
 *   2. For each line, `line_tax = Math.round(line_total * tax_rate)` — half-up
 *      via JS `Math.round`. The constitution names half-even (banker's) as the
 *      target; the deliberate deviation is documented at R-W3-07 and is the
 *      shape every wire & ledger row uses today. Any flip to half-even must
 *      land together with a fixture rewrite in `money-parity.test.ts`.
 *   3. Sum `line_total` into `subtotal_cents`, sum `line_tax` into `tax_cents`.
 *      No compound rounding at the document level.
 *
 * Phase 4 quote totals and Phase 7 invoice totals both call this helper so the
 * SPA preview matches what the BE trigger math will produce at issue time.
 */
export function taxTotalCents(lines: TaxableLine[]): TaxedTotalsCents {
  let subtotal = 0;
  let tax = 0;
  for (const line of lines) {
    const line_total = line.qty * line.unit_price_cents - (line.discount_cents ?? 0);
    const rate = line.tax_rate ?? 0;
    const line_tax = Math.round(line_total * rate);
    subtotal += line_total;
    tax += line_tax;
  }
  return { subtotal_cents: subtotal, tax_cents: tax, total_cents: subtotal + tax };
}

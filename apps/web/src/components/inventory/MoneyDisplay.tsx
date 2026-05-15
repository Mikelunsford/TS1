import { formatMoney } from '@/lib/money';

/**
 * Currency-aware display of a cents value. Thin wrapper over
 * `formatMoney(cents, opts)` — the constitution-approved single math/render
 * surface. We do NOT create a parallel currency-aware helper. Component-level
 * fallbacks: nullish `cents` renders an em-dash; nullish currency falls back
 * to USD.
 */
export interface MoneyDisplayProps {
  cents: number | string | bigint | null | undefined;
  currency?: string | null;
  locale?: string;
  className?: string;
  /** When false, omit the currency symbol. */
  showSymbol?: boolean;
}

export function MoneyDisplay({
  cents,
  currency,
  locale,
  className,
  showSymbol = true,
}: MoneyDisplayProps) {
  if (cents === null || cents === undefined) {
    return <span className={className}>—</span>;
  }
  const opts: { currency: string; showSymbol: boolean; locale?: string } = {
    currency: currency ?? 'USD',
    showSymbol,
  };
  if (locale !== undefined) opts.locale = locale;
  return <span className={className}>{formatMoney(cents, opts)}</span>;
}

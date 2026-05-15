import { useEffect, useState } from 'react';

import { cn } from '@/lib/format';
import { fromCents, toCents, type Cents } from '@/lib/money';

/**
 * Money input. Accepts and emits integer cents. Internal state holds the
 * user-facing string so partial inputs ("12.", "1.2") don't bounce back to the
 * formatted form mid-edit. On blur we round-trip through toCents/fromCents to
 * normalize the display. The constitution rule: math goes through lib/money.ts;
 * we never multiply / divide floats in components.
 *
 * Zero-decimal currencies (JPY, KRW, …) get integer-only display; everything
 * else gets two decimals on commit.
 */

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK']);

export interface MoneyInputProps {
  /** Current value in integer cents. `null`/`undefined` renders as blank. */
  value: Cents | null | undefined;
  /** Fired on blur (committed value) and on submit-ready edits. */
  onChange: (cents: Cents) => void;
  /** ISO 4217. Drives decimal precision on commit. Default 'USD'. */
  currency?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}

function digitsFor(currency: string): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

function centsToInputString(cents: Cents | null | undefined, currency: string): string {
  if (cents === null || cents === undefined) return '';
  const digits = digitsFor(currency);
  const n = fromCents(cents, digits);
  return n.toFixed(digits);
}

export function MoneyInput({
  value,
  onChange,
  currency = 'USD',
  id,
  name,
  disabled,
  placeholder,
  className,
  'aria-label': ariaLabel,
  'aria-describedby': ariaDescribedBy,
}: MoneyInputProps) {
  const digits = digitsFor(currency);
  const [text, setText] = useState<string>(() => centsToInputString(value, currency));

  // Keep local text in sync if the parent value changes (e.g. after a refetch).
  useEffect(() => {
    setText(centsToInputString(value, currency));
  }, [value, currency]);

  function commit(raw: string) {
    if (raw.trim() === '') {
      onChange(0);
      setText(digits === 0 ? '0' : '0.00');
      return;
    }
    try {
      const cents = toCents(raw, digits);
      onChange(cents);
      setText(centsToInputString(cents, currency));
    } catch {
      // Reset to last good value on garbage input.
      setText(centsToInputString(value, currency));
    }
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      id={id}
      name={name}
      disabled={disabled}
      placeholder={placeholder ?? (digits === 0 ? '0' : '0.00')}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      className={cn(
        'w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    />
  );
}

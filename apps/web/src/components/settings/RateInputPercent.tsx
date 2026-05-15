/**
 * RateInputPercent — controlled input that lets the user enter a tax rate
 * as a percentage (e.g. "8.75") while the parent stores the wire-format
 * decimal value (e.g. 0.0875).
 *
 * Constitution lock-ins: bare React state, no react-hook-form. The parent
 * owns the decimal value; this component owns the display string so users
 * can keep typing "8." without losing the trailing dot during onChange.
 */
import { useEffect, useState } from 'react';

export interface RateInputPercentProps {
  /** Wire-format value: decimal 0..1 (e.g. 0.0875 = 8.75%). */
  value: number;
  /** Called with the next wire-format decimal value when the input parses. */
  onChange: (next: number) => void;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  /** Aria-label / testid forwarders. */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'data-testid'?: string;
}

function decimalToDisplay(v: number): string {
  if (!Number.isFinite(v)) return '';
  // Use 4 decimals max in percent (so 0.123456 -> "12.3456"); trim trailing zeros.
  const pct = v * 100;
  const fixed = pct.toFixed(4);
  return fixed.replace(/\.?0+$/, '');
}

export function RateInputPercent({
  value,
  onChange,
  id,
  name,
  required,
  disabled,
  ...rest
}: RateInputPercentProps) {
  const [text, setText] = useState<string>(() => decimalToDisplay(value));

  // If the upstream value changes (e.g. row swap), sync the display unless
  // we're actively editing the same logical value.
  useEffect(() => {
    const parsed = Number(text);
    const same = Number.isFinite(parsed) && Math.abs(parsed / 100 - value) < 1e-9;
    if (!same) setText(decimalToDisplay(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <div className="relative inline-flex items-center">
      <input
        id={id}
        name={name}
        type="number"
        inputMode="decimal"
        step="any"
        min="0"
        max="100"
        required={required}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          if (raw === '' || raw === '-') {
            onChange(0);
            return;
          }
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n / 100);
        }}
        className="w-28 rounded-md border border-border bg-bg px-2 py-1 pr-7 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        aria-label={rest['aria-label']}
        aria-describedby={rest['aria-describedby']}
        data-testid={rest['data-testid']}
      />
      <span
        aria-hidden
        className="pointer-events-none absolute right-2 text-xs text-fg-subtle"
      >
        %
      </span>
    </div>
  );
}

export default RateInputPercent;

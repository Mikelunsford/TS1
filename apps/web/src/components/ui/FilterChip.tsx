/**
 * FilterChip — shared primitive for list-page filter chip rows.
 *
 * Closes the UI-audit "filter chips have no focus ring + wrong shape"
 * finding. Pre-audit, each list page (invoices / expenses / JE / accounts /
 * POs / vendor bills / projects) reimplemented the same chip button inline
 * with subtly different padding and no focus-visible ring — keyboard users
 * couldn't see selection.
 *
 * Visual contract:
 *   - rounded-full (NOT rounded-md — that's StatusBadge's shape; the audit
 *     called out that lookalike rectangular pills behaved differently)
 *   - active: bg-brand text-brand-fg (filled)
 *   - inactive: bordered, hover:bg-bg-muted
 *   - focus-visible:ring-2 ring-brand on every state
 *   - aria-pressed reflects active
 *   - ≥32px touch target via px-3 py-1
 */
import { cn } from '@/lib/cn';

export interface FilterChipProps {
  /** Visible label. */
  label: string;
  /** Whether this chip is the active selection. */
  active: boolean;
  /** Click handler — always rendered as a <button type="button">. */
  onClick: () => void;
  /** Optional count badge appended inside the chip (e.g. "5"). */
  count?: number | undefined;
  /** data-testid forwarded to the <button>. */
  testId?: string | undefined;
}

const BASE =
  'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ' +
  'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ' +
  'focus-visible:ring-offset-1 focus-visible:ring-offset-bg';

const ACTIVE = 'bg-brand text-brand-fg border border-brand';
const INACTIVE = 'border border-border bg-bg text-fg-muted hover:bg-bg-muted';

export function FilterChip({ label, active, onClick, count, testId }: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={cn(BASE, active ? ACTIVE : INACTIVE)}
    >
      <span>{label}</span>
      {count !== undefined && (
        <span
          className={cn(
            'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4',
            active ? 'bg-brand-fg/20 text-brand-fg' : 'bg-bg-muted text-fg-muted',
          )}
          aria-hidden="true"
        >
          {count}
        </span>
      )}
    </button>
  );
}

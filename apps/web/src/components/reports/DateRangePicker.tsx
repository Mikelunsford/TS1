import { cn } from '@/lib/cn';

/**
 * ISO-date range picker for report filters. Native `<input type="date">` —
 * no third-party calendar dep. The parent owns the start/end state and
 * receives `(start, end)` on each change.
 */
export interface DateRangePickerProps {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
  className?: string;
  startLabel?: string;
  endLabel?: string;
  disabled?: boolean;
}

export function DateRangePicker({
  start,
  end,
  onChange,
  className,
  startLabel = 'Start',
  endLabel = 'End',
  disabled,
}: DateRangePickerProps) {
  return (
    <div className={cn('flex flex-wrap items-end gap-2', className)}>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        <span>{startLabel}</span>
        <input
          type="date"
          value={start}
          onChange={(e) => onChange({ start: e.target.value, end })}
          disabled={disabled}
          aria-label={startLabel}
          data-testid="date-range-start"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        <span>{endLabel}</span>
        <input
          type="date"
          value={end}
          onChange={(e) => onChange({ start, end: e.target.value })}
          disabled={disabled}
          aria-label={endLabel}
          data-testid="date-range-end"
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </label>
    </div>
  );
}

/**
 * Single-date "as of" picker for snapshot-style reports.
 */
export interface DatePickerProps {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  className?: string;
  disabled?: boolean;
  testId?: string;
}

export function DatePicker({
  value,
  onChange,
  label = 'As of',
  className,
  disabled,
  testId = 'as-of-date',
}: DatePickerProps) {
  return (
    <label className={cn('flex flex-col gap-1 text-xs text-fg-muted', className)}>
      <span>{label}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
      />
    </label>
  );
}

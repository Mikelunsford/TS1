import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/format';
import { taxKeys } from '@/lib/queryKeys/finance';
import { listTaxes } from '@/lib/services/taxesService';

/**
 * Native <select> over the org's taxes. DB stores `rate` as a 0..1 decimal
 * (e.g. 0.0875 = 8.75%); we render the label with the percentage formatted
 * via Intl. Inactive taxes are filtered out except when the caller currently
 * references one (so existing items keep rendering coherently).
 */
function formatRate(rate: number | string): string {
  const n = typeof rate === 'string' ? Number(rate) : rate;
  if (!Number.isFinite(n)) return '';
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(n);
}

export function TaxPicker({
  value,
  onChange,
  id,
  className,
  includeNone = true,
  disabled,
}: {
  value: string | null;
  onChange: (taxId: string | null) => void;
  id?: string;
  className?: string;
  includeNone?: boolean;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: taxKeys.list(),
    queryFn: () => listTaxes({ is_active: true }),
    staleTime: 60_000,
  });

  const items = (query.data?.items ?? []).filter((t) => t.is_active || t.id === value);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      disabled={disabled || query.isLoading}
      aria-label="Tax"
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    >
      {includeNone && <option value="">— None —</option>}
      {items.length === 0 && !query.isLoading && (
        <option value="" disabled>
          No taxes
        </option>
      )}
      {items.map((t) => (
        <option key={t.id} value={t.id}>
          {t.label} ({formatRate(t.rate)})
        </option>
      ))}
    </select>
  );
}

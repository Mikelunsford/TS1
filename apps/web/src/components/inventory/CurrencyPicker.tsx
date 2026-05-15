import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/format';
import { currencyKeys } from '@/lib/queryKeys/finance';
import { listCurrencies } from '@/lib/services/currenciesService';

/**
 * Native <select> over the global currencies table. `public.currencies` is
 * shared across orgs; the list endpoint returns active codes by default. We
 * always include the caller's current `value` even if it has been deactivated,
 * so an existing item with a since-removed currency still renders sanely.
 */
export function CurrencyPicker({
  value,
  onChange,
  id,
  className,
  includeNone = false,
  disabled,
}: {
  value: string | null;
  onChange: (code: string | null) => void;
  id?: string;
  className?: string;
  includeNone?: boolean;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: currencyKeys.list(),
    queryFn: () => listCurrencies({ is_active: true }),
    staleTime: 5 * 60_000,
  });

  const items = query.data?.items ?? [];
  const includesValue = value ? items.some((c) => c.code === value) : true;

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      disabled={disabled || query.isLoading}
      aria-label="Currency"
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    >
      {includeNone && <option value="">— None —</option>}
      {!includesValue && value && (
        <option value={value}>{value} (inactive)</option>
      )}
      {items.length === 0 && !query.isLoading && (
        <option value="" disabled>
          No currencies
        </option>
      )}
      {items.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} — {c.label}
        </option>
      ))}
    </select>
  );
}

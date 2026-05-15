import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/format';
import { unitKeys } from '@/lib/queryKeys/inventory';
import { listUnits } from '@/lib/services/unitsService';

/**
 * Native <select> over the org's units of measure. Loads from the
 * inventory-api list endpoint. Empty options render a disabled "No units"
 * placeholder so the control degrades gracefully when no units are seeded.
 */
export function UnitPicker({
  value,
  onChange,
  id,
  className,
  includeNone = true,
  disabled,
}: {
  value: string | null;
  onChange: (unitId: string | null) => void;
  id?: string;
  className?: string;
  includeNone?: boolean;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: unitKeys.list(),
    queryFn: () => listUnits(),
    staleTime: 60_000,
  });

  const options = (query.data?.items ?? []).filter((u) => u.is_active || u.id === value);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      disabled={disabled || query.isLoading}
      aria-label="Unit"
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    >
      {includeNone && <option value="">— None —</option>}
      {options.length === 0 && !query.isLoading && (
        <option value="" disabled>
          No units
        </option>
      )}
      {options.map((u) => (
        <option key={u.id} value={u.id}>
          {u.label} ({u.code})
        </option>
      ))}
    </select>
  );
}

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { cn } from '@/lib/format';
import { itemCategoryKeys } from '@/lib/queryKeys/inventory';
import { listItemCategories } from '@/lib/services/itemCategoriesService';
import type { ItemCategory } from '@/lib/types';

/**
 * Native <select> over the org's item categories. The list endpoint returns a
 * flat array; we sort alphabetically here. A hierarchical surface lives in
 * CategoryTree — this picker is intentionally flat to keep the form compact.
 */
export function ItemCategoryPicker({
  value,
  onChange,
  id,
  className,
  includeNone = true,
  disabled,
}: {
  value: string | null;
  onChange: (categoryId: string | null) => void;
  id?: string;
  className?: string;
  includeNone?: boolean;
  disabled?: boolean;
}) {
  const query = useQuery({
    queryKey: itemCategoryKeys.list(),
    queryFn: () => listItemCategories(),
    staleTime: 60_000,
  });

  const options = useMemo(() => {
    const items: ItemCategory[] = query.data?.items ?? [];
    const filtered = items.filter((c) => c.is_active || c.id === value);
    filtered.sort((a, b) => a.label.localeCompare(b.label));
    return filtered;
  }, [query.data, value]);

  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      disabled={disabled || query.isLoading}
      aria-label="Category"
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
    >
      {includeNone && <option value="">— Uncategorized —</option>}
      {options.length === 0 && !query.isLoading && (
        <option value="" disabled>
          No categories
        </option>
      )}
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.label}
        </option>
      ))}
    </select>
  );
}

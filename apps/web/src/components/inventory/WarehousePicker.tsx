/**
 * WarehousePicker — searchable warehouse selector. Mirrors VendorPicker
 * shape (debounced text search + native <select>). Emits the warehouse id
 * + label on change.
 *
 * Wave 8f / Phase 13.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { warehouseKeys } from '@/lib/queryKeys/warehouses';
import { listWarehouses } from '@/lib/services/warehousesService';

interface Props {
  value: string;
  onChange: (warehouseId: string, label: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  includeArchived?: boolean;
  'data-testid'?: string;
}

export function WarehousePicker({
  value,
  onChange,
  id,
  disabled,
  placeholder = 'Select a warehouse…',
  includeArchived = false,
  ...rest
}: Props) {
  const [q, setQ] = useState('');
  const queryFilters = {
    ...(q ? { q } : {}),
    ...(includeArchived ? {} : { is_active: true }),
  };
  const query = useQuery({
    queryKey: warehouseKeys.list(queryFilters),
    queryFn: () => listWarehouses(queryFilters),
    staleTime: 30_000,
  });
  const warehouses = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-1">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search warehouses…"
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        aria-label="Warehouse search"
      />
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const w = warehouses.find((ww) => ww.id === e.target.value);
          onChange(e.target.value, w?.label ?? '');
        }}
        data-testid={rest['data-testid'] ?? 'warehouse-picker'}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <option value="">{placeholder}</option>
        {warehouses.map((w) => (
          <option key={w.id} value={w.id}>
            {w.label} ({w.code}){w.is_default ? ' • default' : ''}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * Searchable vendor selector. Mirrors the inline customer-picker pattern
 * used in InvoiceCreatePage — debounced text search + native <select>.
 * Emits the vendor id (or empty string) on change.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { vendorKeys } from '@/lib/queryKeys/vendors';
import { listVendors } from '@/lib/services/vendorsService';

interface Props {
  value: string;
  onChange: (vendorId: string, vendorName: string) => void;
  id?: string;
  disabled?: boolean;
  placeholder?: string;
  'data-testid'?: string;
}

export function VendorPicker({
  value,
  onChange,
  id,
  disabled,
  placeholder = 'Select a vendor…',
  ...rest
}: Props) {
  const [q, setQ] = useState('');
  const queryFilters = q ? { q, is_active: true } : { is_active: true };
  const query = useQuery({
    queryKey: vendorKeys.list(queryFilters),
    queryFn: () => listVendors(queryFilters),
    staleTime: 30_000,
  });
  const vendors = query.data?.items ?? [];

  return (
    <div className="flex flex-col gap-1">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search vendors…"
        className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        aria-label="Vendor search"
      />
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => {
          const v = vendors.find((vv) => vv.id === e.target.value);
          onChange(e.target.value, v?.name ?? '');
        }}
        data-testid={rest['data-testid'] ?? 'vendor-picker'}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <option value="">{placeholder}</option>
        {vendors.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>
    </div>
  );
}

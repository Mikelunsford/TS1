/**
 * PaymentMethodPicker — `<select>` over active payment methods.
 *
 * Mirrors the established picker pattern (CurrencyPicker, TaxPicker). Calls
 * `listPaymentMethods({ is_active: true })`. On first load, when no value is
 * set yet, auto-selects the row flagged `is_default` so the create form
 * starts with a sensible choice.
 */
import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';

import { listPaymentMethods } from '@/lib/services/paymentMethodsService';
import type { PaymentMethod } from '@/lib/types';

export interface PaymentMethodPickerProps {
  value: string;
  onChange: (id: string, method: PaymentMethod | null) => void;
  id?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  'data-testid'?: string;
}

export function PaymentMethodPicker({
  value,
  onChange,
  id,
  disabled,
  allowEmpty = true,
  'data-testid': testId,
}: PaymentMethodPickerProps) {
  const query = useQuery({
    queryKey: ['finance', 'payment-methods', 'list', { is_active: true }],
    queryFn: () => listPaymentMethods({ is_active: true }),
    staleTime: 60_000,
  });

  const items = query.data?.items ?? [];

  // Default-select the is_default row when the caller has no value yet.
  useEffect(() => {
    if (value || !items.length) return;
    const def = items.find((m) => m.is_default);
    if (def) onChange(def.id, def);
  }, [value, items, onChange]);

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => {
        const id = e.target.value;
        const m = items.find((x) => x.id === id) ?? null;
        onChange(id, m);
      }}
      disabled={disabled || query.isLoading}
      className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
      data-testid={testId}
    >
      {allowEmpty && <option value="">(none)</option>}
      {items.map((m) => (
        <option key={m.id} value={m.id}>
          {m.label}
          {m.is_default ? ' (default)' : ''}
        </option>
      ))}
    </select>
  );
}

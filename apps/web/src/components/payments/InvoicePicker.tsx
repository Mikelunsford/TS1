/**
 * InvoicePicker — autocomplete-style combobox for selecting an invoice.
 *
 * Used by PaymentCreatePage (pick invoice to pay) and ApplyCreditDialog
 * (pick invoice to apply credit to). Searches the invoice list via the
 * existing `listInvoices({ q })` service.
 *
 * The picker filters the rendered options to the statuses passed in via
 * `payableStatuses` (defaults to: sent, partially_paid, overdue). The BE
 * list does not support a `status__in` filter, so we filter on the client
 * after fetching by `q`.
 *
 * On selection, `onSelect` is called with the full Invoice row so callers
 * can pin currency, balance, etc.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { formatMoney } from '@/lib/money';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { listInvoices } from '@/lib/services/invoicesService';
import type { Invoice } from '@/lib/types';

const DEFAULT_PAYABLE: ReadonlyArray<Invoice['status']> = [
  'sent',
  'partially_paid',
  'overdue',
];

export interface InvoicePickerProps {
  /** Currently selected invoice id. */
  value: string;
  /** Fires with the full row when an option is picked. */
  onSelect: (invoice: Invoice | null) => void;
  /** Restrict which statuses are shown. Defaults to sent/partially_paid/overdue. */
  payableStatuses?: ReadonlyArray<Invoice['status']>;
  /** Pre-scope to a single customer when set. */
  customerId?: string;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  'data-testid'?: string;
}

export function InvoicePicker({
  value,
  onSelect,
  payableStatuses = DEFAULT_PAYABLE,
  customerId,
  id,
  placeholder = 'Search invoices…',
  disabled,
  'data-testid': testId,
}: InvoicePickerProps) {
  const [q, setQ] = useState('');

  const listFilters: { q?: string; customer_id?: string } = {};
  if (q) listFilters.q = q;
  if (customerId) listFilters.customer_id = customerId;

  const query = useQuery({
    queryKey: [...invoiceKeys.list(listFilters)],
    queryFn: () => listInvoices(listFilters),
    staleTime: 15_000,
  });

  const items = (query.data?.items ?? []).filter((inv) =>
    payableStatuses.includes(inv.status),
  );

  return (
    <div className="flex flex-col gap-1">
      <input
        id={id ? `${id}-search` : undefined}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        data-testid={testId ? `${testId}-search` : undefined}
      />
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const id = e.target.value;
          const inv = items.find((i) => i.id === id) ?? null;
          onSelect(inv);
        }}
        disabled={disabled}
        className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
        data-testid={testId}
      >
        <option value="">Select an invoice…</option>
        {items.map((inv) => {
          const balance =
            inv.balance_cents !== null && inv.balance_cents !== undefined
              ? formatMoney(inv.balance_cents, { currency: inv.currency_code })
              : '';
          return (
            <option key={inv.id} value={inv.id}>
              {inv.invoice_number} — {inv.customer_name_snapshot}
              {balance ? ` (bal ${balance})` : ''}
            </option>
          );
        })}
      </select>
    </div>
  );
}

/**
 * VendorBillListPage — paginated vendor bill list with 7-state chip
 * filter. Vendor bills are header-only in prod (no line items table).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { VendorBillStatusBadge } from '@/components/procurement/VendorBillStatusBadge';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { vendorBillKeys } from '@/lib/queryKeys/vendorBills';
import {
  listVendorBills,
  type VendorBillListFilters,
} from '@/lib/services/vendorBillsService';
import type { VendorBillState } from '@/lib/workflow';

const STATUS_VALUES: readonly VendorBillState[] = [
  'draft',
  'pending',
  'approved',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
];

export default function VendorBillListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const vendorId = searchParams.get('vendor_id') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('vendor_bills.write');

  const filters: VendorBillListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (vendorId) filters.vendor_id = vendorId;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: vendorBillKeys.list(filters),
    queryFn: () => listVendorBills(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if (Object.keys(next).some((k) => k !== 'cursor')) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  function toggleStatus(value: VendorBillState) {
    update({ status: status === value ? '' : value });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Vendor bills</h1>
          <p className="text-sm text-fg-muted">Bills you owe to suppliers.</p>
        </div>
        {canWrite && (
          <Link
            to="/vendor-bills/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-vendor-bill-link"
          >
            New vendor bill
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Vendor bill filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Bill # or vendor"
          className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Search"
        />
        <input
          type="text"
          value={vendorId}
          onChange={(e) => update({ vendor_id: e.target.value })}
          placeholder="Vendor ID (UUID)"
          className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Vendor ID"
        />
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Status filter"
        data-testid="status-chips"
      >
        {STATUS_VALUES.map((s) => {
          const active = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-0.5 text-xs font-medium',
                active
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-border bg-bg text-fg-muted hover:bg-bg-muted',
              )}
              data-testid={`status-chip-${s}`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {query.isLoading && <TableSkeleton rows={6} cols={6} />}
      {query.error && <ErrorState title="Could not load vendor bills" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No vendor bills found"
          description={canWrite ? 'Record a vendor bill to get started.' : 'Bills will appear here once added.'}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Bill #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                <th scope="col" className="px-3 py-2 font-medium">Due</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((b) => (
                <tr key={b.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/vendor-bills/${b.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {b.bill_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <VendorBillStatusBadge status={b.status} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(b.issue_date)}</td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(b.due_date)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={b.total_cents} currency={b.currency_code} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={b.balance_cents} currency={b.currency_code} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {query.data?.next_cursor && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => update({ cursor: query.data?.next_cursor ?? undefined })}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Next page
          </button>
        </div>
      )}
    </div>
  );
}

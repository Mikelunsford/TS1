/**
 * PurchaseOrderListPage — paginated PO list with status chip filter.
 *
 * Wave 7 / Phase 10. Constitutional invariant: state spelling is
 * `partial_received` (one r) per prod CHECK.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { PurchaseOrderStatusBadge } from '@/components/procurement/PurchaseOrderStatusBadge';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { purchaseOrderKeys } from '@/lib/queryKeys/purchaseOrders';
import {
  listPurchaseOrders,
  type PurchaseOrderListFilters,
} from '@/lib/services/purchaseOrdersService';
import type { PurchaseOrderState } from '@/lib/workflow';

const STATUS_VALUES: readonly PurchaseOrderState[] = [
  'draft',
  'submitted',
  'approved',
  'partial_received',
  'received',
  'closed',
  'cancelled',
];

export default function PurchaseOrderListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const vendorId = searchParams.get('vendor_id') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('purchase_orders.write');

  const filters: PurchaseOrderListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (vendorId) filters.vendor_id = vendorId;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: purchaseOrderKeys.list(filters),
    queryFn: () => listPurchaseOrders(filters),
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

  function toggleStatus(value: PurchaseOrderState) {
    update({ status: status === value ? '' : value });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Purchase orders</h1>
          <p className="text-sm text-fg-muted">Procurement workflow.</p>
        </div>
        {canWrite && (
          <Link
            to="/purchase-orders/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-po-link"
          >
            New PO
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="PO filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="po-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="po-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="PO # or vendor"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-vendor" className="text-xs uppercase tracking-wide text-fg-subtle">
            Vendor ID
          </label>
          <input
            id="po-vendor"
            type="text"
            value={vendorId}
            onChange={(e) => update({ vendor_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-from" className="text-xs uppercase tracking-wide text-fg-subtle">
            Issued from
          </label>
          <input
            id="po-from"
            type="date"
            value={from}
            onChange={(e) => update({ from: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-to" className="text-xs uppercase tracking-wide text-fg-subtle">
            Issued to
          </label>
          <input
            id="po-to"
            type="date"
            value={to}
            onChange={(e) => update({ to: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
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
      {query.error && <ErrorState title="Could not load POs" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No purchase orders found"
          description={canWrite ? 'Create your first PO to get started.' : 'POs will appear here once added.'}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">PO #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                <th scope="col" className="px-3 py-2 font-medium">Expected</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-3 py-2 font-medium">Currency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((po) => (
                <tr key={po.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/purchase-orders/${po.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {po.po_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <PurchaseOrderStatusBadge status={po.status} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(po.issue_date)}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {po.expected_date ? formatDate(po.expected_date) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={po.total_cents} currency={po.currency_code} />
                  </td>
                  <td className="px-3 py-2 font-mono">{po.currency_code}</td>
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

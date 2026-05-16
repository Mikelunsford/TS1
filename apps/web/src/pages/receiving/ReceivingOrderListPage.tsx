/**
 * ReceivingOrderListPage — paginated list of receiving orders.
 * Wave 8f / Phase 13. See TS1/09-api/00-API-CONTRACT.md §13.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ReceivingOrderStatusBadge } from '@/components/ops/ReceivingOrderStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { receivingOrderKeys } from '@/lib/queryKeys/receivingOrders';
import {
  listReceivingOrders,
  type ReceivingOrderListFilters,
} from '@/lib/services/receivingOrdersService';
import type { ReceivingOrderState } from '@/lib/workflow';

const STATUSES: ReceivingOrderState[] = ['open', 'partial', 'received', 'cancelled'];

export default function ReceivingOrderListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const source = searchParams.get('source') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const { can } = useCapabilities();
  const canWrite = can('receiving.write');

  const filters: ReceivingOrderListFilters = {};
  if (status) filters.status = status;
  if (source) filters.source = source;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: receivingOrderKeys.list(filters),
    queryFn: () => listReceivingOrders(filters),
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

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Receiving orders</h1>
          <p className="text-sm text-fg-muted">
            Inbound material receipts (customer-supplied or T1-purchased).
          </p>
        </div>
        {canWrite && (
          <Link
            to="/receiving/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-ro-link"
          >
            New receiving order
          </Link>
        )}
      </header>

      <section className="flex flex-wrap items-end gap-3" aria-label="Filters">
        <div className="flex flex-col gap-1">
          <label htmlFor="ro-status" className="text-xs uppercase tracking-wide text-fg-subtle">Status</label>
          <select
            id="ro-status"
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ro-source" className="text-xs uppercase tracking-wide text-fg-subtle">Source</label>
          <select
            id="ro-source"
            value={source}
            onChange={(e) => update({ source: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <option value="">All</option>
            <option value="customer_supplied">Customer supplied</option>
            <option value="t1_purchase">T1 purchase</option>
          </select>
        </div>
      </section>

      {query.isLoading && <TableSkeleton rows={5} cols={6} />}
      {query.error && <ErrorState title="Could not load receiving orders" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No receiving orders"
          description={canWrite ? 'Create one to track inbound material.' : 'They will appear here when added.'}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">RO #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Source</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Expected</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Received</th>
                <th scope="col" className="px-3 py-2 font-medium">Expected at</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((ro) => (
                <tr key={ro.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2">
                    <Link to={`/receiving/${ro.id}`} className="text-brand hover:underline font-mono text-xs">
                      {ro.ro_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <ReceivingOrderStatusBadge status={ro.status} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted text-xs">{ro.source}</td>
                  <td className="px-3 py-2 text-right font-mono">{String(ro.expected_qty)}</td>
                  <td className="px-3 py-2 text-right font-mono">{String(ro.received_qty)}</td>
                  <td className="px-3 py-2 text-fg-muted">{ro.expected_at ? formatDate(ro.expected_at) : '—'}</td>
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

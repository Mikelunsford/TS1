/**
 * ShipmentListPage — paginated list of shipments. Wave 8f / Phase 13.
 * See TS1/09-api/00-API-CONTRACT.md §13.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ExportButton } from '@/components/exports/ExportButton';
import { ShipmentStatusBadge } from '@/components/ops/ShipmentStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { shipmentKeys } from '@/lib/queryKeys/shipments';
import {
  listShipments,
  type ShipmentListFilters,
} from '@/lib/services/shipmentsService';
import type { ShipmentState } from '@/lib/workflow';

const STATUSES: ShipmentState[] = ['scheduled', 'loading', 'shipped', 'cancelled'];

export default function ShipmentListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const { can } = useCapabilities();
  const canWrite = can('shipping.write');

  const filters: ShipmentListFilters = {};
  if (status) filters.status = status;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: shipmentKeys.list(filters),
    queryFn: () => listShipments(filters),
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
          <h1 className="text-2xl font-semibold">Shipments</h1>
          <p className="text-sm text-fg-muted">
            Outbound shipments. At most one non-terminal shipment per project (BE-enforced).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="shipments" />
          {canWrite && (
            <Link
              to="/shipments/new"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="new-shipment-link"
            >
              New shipment
            </Link>
          )}
        </div>
      </header>

      <section className="flex flex-wrap items-end gap-3" aria-label="Filters">
        <div className="flex flex-col gap-1">
          <label htmlFor="shipment-status" className="text-xs uppercase tracking-wide text-fg-subtle">
            Status
          </label>
          <select
            id="shipment-status"
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
      </section>

      {query.isLoading && <TableSkeleton rows={5} cols={6} />}
      {query.error && <ErrorState title="Could not load shipments" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No shipments"
          description={canWrite ? 'Schedule one to dispatch finished goods.' : 'They will appear here when added.'}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Shipment #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Carrier</th>
                <th scope="col" className="px-3 py-2 font-medium">Tracking</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Qty</th>
                <th scope="col" className="px-3 py-2 font-medium">Scheduled pickup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((s) => (
                <tr key={s.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2">
                    <Link to={`/shipments/${s.id}`} className="text-brand hover:underline font-mono text-xs">
                      {s.shipment_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><ShipmentStatusBadge status={s.status} /></td>
                  <td className="px-3 py-2">{s.carrier_name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-fg-muted">{s.tracking_number ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{String(s.qty_shipped)}</td>
                  <td className="px-3 py-2 text-fg-muted">{s.scheduled_pickup_at ? formatDate(s.scheduled_pickup_at) : '—'}</td>
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

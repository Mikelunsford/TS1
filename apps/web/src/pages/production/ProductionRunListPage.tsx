/**
 * ProductionRunListPage — paginated list of production runs. Wave 8f /
 * Phase 13. See TS1/09-api/00-API-CONTRACT.md §13.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';

import { ProductionRunStatusBadge } from '@/components/ops/ProductionRunStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { productionRunKeys } from '@/lib/queryKeys/productionRuns';
import {
  listProductionRuns,
  type ProductionRunListFilters,
} from '@/lib/services/productionRunsService';
import type { ProductionRunState } from '@/lib/workflow';

const STATUSES: ProductionRunState[] = ['scheduled', 'in_progress', 'completed', 'cancelled'];

export default function ProductionRunListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const { can } = useCapabilities();
  const canWrite = can('production.write');

  const filters: ProductionRunListFilters = {};
  if (status) filters.status = status;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: productionRunKeys.list(filters),
    queryFn: () => listProductionRuns(filters),
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
          <h1 className="text-2xl font-semibold">Production runs</h1>
          <p className="text-sm text-fg-muted">
            At most one non-terminal run per project (BE-enforced).
          </p>
        </div>
        {canWrite && (
          <Link
            to="/production/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-run-link"
          >
            New production run
          </Link>
        )}
      </header>

      <section className="flex flex-wrap items-end gap-3" aria-label="Filters">
        <div className="flex flex-col gap-1">
          <label htmlFor="run-status" className="text-xs uppercase tracking-wide text-fg-subtle">Status</label>
          <select
            id="run-status"
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

      {query.isLoading && <TableSkeleton rows={5} cols={5} />}
      {query.error && <ErrorState title="Could not load production runs" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No production runs"
          description={canWrite ? 'Schedule one to start manufacturing.' : 'They will appear here when added.'}
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Run #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium text-right">Target qty</th>
                <th scope="col" className="px-3 py-2 font-medium">Scheduled for</th>
                <th scope="col" className="px-3 py-2 font-medium">Started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((r) => (
                <tr key={r.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2">
                    <Link to={`/production/${r.id}`} className="text-brand hover:underline font-mono text-xs">
                      {r.run_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2"><ProductionRunStatusBadge status={r.status} /></td>
                  <td className="px-3 py-2 text-right font-mono">{String(r.qty_target)}</td>
                  <td className="px-3 py-2 text-fg-muted">{r.scheduled_for ? formatDate(r.scheduled_for) : '—'}</td>
                  <td className="px-3 py-2 text-fg-muted">{r.started_at ? formatDate(r.started_at) : '—'}</td>
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

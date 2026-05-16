/**
 * WarehouseListPage — paginated warehouse list with search + active filter.
 * Wave 8f / Phase 13. See TS1/09-api/00-API-CONTRACT.md §9.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { warehouseKeys } from '@/lib/queryKeys/warehouses';
import {
  listWarehouses,
  type WarehouseListFilters,
} from '@/lib/services/warehousesService';

export default function WarehouseListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const includeInactive = searchParams.get('include_inactive') === '1';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('inventory.warehouses.write');

  const filters: WarehouseListFilters = {};
  if (q) filters.q = q;
  if (!includeInactive) filters.is_active = true;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: warehouseKeys.list(filters),
    queryFn: () => listWarehouses(filters),
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
          <h1 className="text-2xl font-semibold">Warehouses</h1>
          <p className="text-sm text-fg-muted">Stocking locations for inventory items.</p>
        </div>
        {canWrite && (
          <Link
            to="/warehouses/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-warehouse-link"
          >
            New warehouse
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Warehouse filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="warehouses-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="warehouses-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Code or label"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => update({ include_inactive: e.target.checked ? '1' : '' })}
          />
          Include archived
        </label>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {query.isLoading && <TableSkeleton rows={5} cols={5} />}
      {query.error && <ErrorState title="Could not load warehouses" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No warehouses found"
          description={
            canWrite
              ? 'Create your first warehouse to start tracking stock.'
              : 'Warehouses will appear here once added.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Code</th>
                <th scope="col" className="px-3 py-2 font-medium">Label</th>
                <th scope="col" className="px-3 py-2 font-medium">Default</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((w) => (
                <tr key={w.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono text-xs">{w.code}</td>
                  <td className="px-3 py-2">
                    {canWrite ? (
                      <Link
                        to={`/warehouses/${w.id}/edit`}
                        className="text-brand hover:underline"
                      >
                        {w.label}
                      </Link>
                    ) : (
                      w.label
                    )}
                  </td>
                  <td className="px-3 py-2">{w.is_default ? 'Yes' : '—'}</td>
                  <td className="px-3 py-2 text-fg-muted">
                    {w.is_active ? 'Active' : 'Archived'}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(w.created_at)}</td>
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

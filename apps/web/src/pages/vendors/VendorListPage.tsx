/**
 * VendorListPage — paginated list of vendors with search + is_active
 * toggle. URL params drive filter state.
 *
 * Wave 7 / Phase 10. See TS1/09-api/00-API-CONTRACT.md §10.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { vendorKeys } from '@/lib/queryKeys/vendors';
import { listVendors, type VendorListFilters } from '@/lib/services/vendorsService';

export default function VendorListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const includeInactive = searchParams.get('include_inactive') === '1';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('vendors.write');

  const filters: VendorListFilters = {};
  if (q) filters.q = q;
  if (!includeInactive) filters.is_active = true;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: vendorKeys.list(filters),
    queryFn: () => listVendors(filters),
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
          <h1 className="text-2xl font-semibold">Vendors</h1>
          <p className="text-sm text-fg-muted">Suppliers you purchase from.</p>
        </div>
        {canWrite && (
          <Link
            to="/vendors/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-vendor-link"
          >
            New vendor
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Vendor filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="vendors-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="vendors-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Vendor name"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
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

      {query.isLoading && <TableSkeleton rows={6} cols={5} />}
      {query.error && <ErrorState title="Could not load vendors" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No vendors found"
          description={
            q
              ? 'Try clearing filters.'
              : canWrite
                ? 'Create your first vendor to get started.'
                : 'Vendors will appear here once added.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Name</th>
                <th scope="col" className="px-3 py-2 font-medium">Email</th>
                <th scope="col" className="px-3 py-2 font-medium">Currency</th>
                <th scope="col" className="px-3 py-2 font-medium">Terms (days)</th>
                <th scope="col" className="px-3 py-2 font-medium">Added</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((v) => (
                <tr key={v.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2">
                    <Link
                      to={`/vendors/${v.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {v.name}
                    </Link>
                    {!v.is_active && (
                      <span className="ml-2 rounded-md bg-bg-muted px-2 py-0.5 text-xs text-fg-subtle">
                        archived
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{v.email ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{v.currency_code ?? '—'}</td>
                  <td className="px-3 py-2 font-mono">{v.payment_terms_days}</td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(v.created_at)}</td>
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

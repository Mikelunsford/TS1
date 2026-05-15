import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { StatusBadge, type ClientStatus } from '@/components/ui/StatusBadge';
import { formatMoney } from '@/lib/money';
import { customerKeys } from '@/lib/queryKeys/crm';
import { listCustomers } from '@/lib/services/customersService';

const STATUS_OPTIONS: Array<{ value: ClientStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'new', label: 'New' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'archived', label: 'Archived' },
];

/**
 * Customers list — filter by status + free-text q, paginated by next_cursor.
 *
 * Phase 7 (invoicing) will replace the outstanding-balance stub column with
 * a real value joined from the invoices module. Until then we render a zero
 * stub so the column shape is locked in.
 */
export default function CustomersListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const status = (searchParams.get('status') ?? 'all') as ClientStatus | 'all';
  const q = searchParams.get('q') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  // Local input state so typing doesn't re-fetch on every keystroke; commit
  // on submit. Derived-state-free per the constitution.
  const [qInput, setQInput] = useState(q);

  const queryParams: { q?: string; status?: string; cursor?: string } = {};
  if (q) queryParams.q = q;
  if (status !== 'all') queryParams.status = status;
  if (cursor) queryParams.cursor = cursor;
  const query = useQuery({
    queryKey: customerKeys.list(queryParams),
    queryFn: () => listCustomers(queryParams),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    // Any filter change resets pagination.
    if ('q' in next || 'status' in next) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Customers</h1>
        <p className="text-sm text-fg-muted">
          Companies and individuals you sell to. Filter, search, and drill in.
        </p>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Customer filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="customers-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="customers-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Name, email, or tag"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="customers-status"
            className="text-xs uppercase tracking-wide text-fg-subtle"
          >
            Status
          </label>
          <select
            id="customers-status"
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {query.isLoading && <TableSkeleton rows={6} cols={5} />}
      {query.error && <ErrorState title="Could not load customers" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No customers found"
          description={
            q || status !== 'all'
              ? 'Try clearing filters to see all customers.'
              : 'Customers added through the API or imports will appear here.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Email
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Tags
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Outstanding
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((c) => {
                // Backend's response Customer omits `tags`; defensively read.
                const tags = (c as { tags?: string[] }).tags ?? [];
                const currency = c.default_currency_code ?? 'USD';
                return (
                  <tr key={c.id} className="hover:bg-bg-muted">
                    <td className="px-3 py-2">
                      <Link
                        to={`/crm/customers/${c.id}`}
                        className="font-medium text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                      >
                        {c.display_name}
                      </Link>
                      <div className="text-xs text-fg-subtle">
                        {c.kind === 'company' ? 'Company' : 'Individual'}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={c.client_status} />
                    </td>
                    <td className="px-3 py-2">
                      {c.primary_email ?? <span className="text-fg-subtle">—</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 3).map((t) => (
                          <Badge key={t}>{t}</Badge>
                        ))}
                        {tags.length > 3 && (
                          <span className="text-xs text-fg-subtle">+{tags.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td
                      className="px-3 py-2 text-right font-mono"
                      title="Wave 3 will replace this stub"
                    >
                      {formatMoney(0, { currency })}
                    </td>
                  </tr>
                );
              })}
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

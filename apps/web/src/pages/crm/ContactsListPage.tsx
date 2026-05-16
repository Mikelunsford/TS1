import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ExportButton } from '@/components/exports/ExportButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { contactKeys } from '@/lib/queryKeys/crm';
import { listContacts, type ContactListFilters } from '@/lib/services/contactsService';

/**
 * Contacts list — flat list across the org. Supports filtering by
 * `customer_id` (via query string) and free-text search.
 */
export default function ContactsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const customerId = searchParams.get('customer_id') ?? undefined;
  const q = searchParams.get('q') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);

  // Backend's contacts service doesn't yet support free-text `q`; we keep it
  // in the URL for UX continuity and apply it as a client-side filter below.
  const params: ContactListFilters = {};
  if (customerId) params.customer_id = customerId;
  if (cursor) params.cursor = cursor;
  const query = useQuery({
    queryKey: contactKeys.list({ ...params, q }),
    queryFn: () => listContacts(params),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  const filteredItems = (query.data?.items ?? []).filter((c) => {
    if (!q) return true;
    const needle = q.toLowerCase();
    const name = `${c.first_name} ${c.last_name ?? ''}`.toLowerCase();
    const email = (c.email ?? '').toLowerCase();
    const title = (c.title ?? '').toLowerCase();
    return name.includes(needle) || email.includes(needle) || title.includes(needle);
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if ('q' in next || 'customer_id' in next) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-sm text-fg-muted">
            Individual people across all customers. Filter by customer or search by name and email.
          </p>
        </div>
        <ExportButton entity="contacts" />
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Contact filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="contacts-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="contacts-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Name, email, title"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        {customerId && (
          <button
            type="button"
            onClick={() => update({ customer_id: undefined })}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Clear customer filter
          </button>
        )}
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {query.isLoading && <TableSkeleton rows={5} cols={4} />}
      {query.error && <ErrorState title="Could not load contacts" error={query.error} />}
      {query.data && filteredItems.length === 0 && (
        <EmptyState
          title="No contacts found"
          description="Add contacts from a customer's detail page."
        />
      )}

      {query.data && filteredItems.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Name
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Title
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Email
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Customer
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredItems.map((c) => (
                <tr key={c.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-medium text-fg">
                    {[c.first_name, c.last_name].filter(Boolean).join(' ')}
                    {c.is_primary && (
                      <span className="ml-2 text-xs uppercase tracking-wide text-fg-subtle">
                        Primary
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{c.title ?? '—'}</td>
                  <td className="px-3 py-2">
                    {c.email ? (
                      <a className="text-brand hover:underline" href={`mailto:${c.email}`}>
                        {c.email}
                      </a>
                    ) : (
                      <span className="text-fg-subtle">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      to={`/crm/customers/${c.customer_id}`}
                      className="text-brand hover:underline"
                    >
                      View
                    </Link>
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

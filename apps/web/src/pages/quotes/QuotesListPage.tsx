/**
 * QuotesListPage — paginated list of quotes with filter chips.
 *
 * URL params drive filter state so each filter set is bookmarkable
 * (same pattern as ItemsListPage / CustomersListPage). Cap-gates the
 * "New Quote" button on `quotes.write`; users without write still see
 * the list (which requires `quotes.read`).
 *
 * See TS1/09-api/00-API-CONTRACT.md §4.1.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { QuoteStatusBadge } from '@/components/quotes/QuoteStatusBadge';
import { ExportButton } from '@/components/exports/ExportButton';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { quoteKeys } from '@/lib/queryKeys/quotes';
import { listQuotes, type QuoteListFilters } from '@/lib/services/quotesService';
import { QuoteStateSchema, type QuoteState } from '@/lib/types';

const STATUS_VALUES: readonly QuoteState[] = QuoteStateSchema.options;

export default function QuotesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const customerId = searchParams.get('customer_id') ?? '';
  const currencyCode = searchParams.get('currency_code') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('quotes.write');

  const filters: QuoteListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (customerId) filters.customer_id = customerId;
  if (currencyCode) filters.currency_code = currencyCode;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: quoteKeys.list(filters),
    queryFn: () => listQuotes(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if ('q' in next || 'status' in next || 'customer_id' in next || 'currency_code' in next) {
      sp.delete('cursor');
    }
    setSearchParams(sp, { replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Quotes</h1>
          <p className="text-sm text-fg-muted">
            Manage quotes for customers across their lifecycle.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="quotes" />
          {canWrite && (
            <Link
              to="/quotes/new"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="new-quote-link"
            >
              New quote
            </Link>
          )}
        </div>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Quote filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="quotes-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="quotes-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Quote # or customer"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="quotes-status" className="text-xs uppercase tracking-wide text-fg-subtle">
            Status
          </label>
          <select
            id="quotes-status"
            value={status}
            onChange={(e) => update({ status: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="status-filter"
          >
            <option value="">All statuses</option>
            {STATUS_VALUES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="quotes-currency"
            className="text-xs uppercase tracking-wide text-fg-subtle"
          >
            Currency
          </label>
          <input
            id="quotes-currency"
            type="text"
            maxLength={3}
            value={currencyCode}
            onChange={(e) => update({ currency_code: e.target.value.toUpperCase() })}
            placeholder="USD"
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            htmlFor="quotes-customer"
            className="text-xs uppercase tracking-wide text-fg-subtle"
          >
            Customer ID
          </label>
          <input
            id="quotes-customer"
            type="text"
            value={customerId}
            onChange={(e) => update({ customer_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

      {query.isLoading && <TableSkeleton rows={6} cols={6} />}
      {query.error && <ErrorState title="Could not load quotes" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No quotes found"
          description={
            q || status || customerId || currencyCode
              ? 'Try clearing filters to see all quotes.'
              : canWrite
                ? 'Create your first quote to get started.'
                : 'Quotes will appear here when sales adds them.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Quote #
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Total
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Valid until
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Created
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((quote) => (
                <tr key={quote.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/quotes/${quote.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {quote.quote_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <QuoteStatusBadge status={quote.status} />
                  </td>
                  <td className="px-3 py-2">{quote.customer_name}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={quote.total_cents} currency={quote.currency_code} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">
                    {quote.valid_until ? formatDate(quote.valid_until) : '—'}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(quote.created_at)}</td>
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

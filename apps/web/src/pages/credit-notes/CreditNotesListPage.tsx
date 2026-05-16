/**
 * CreditNotesListPage — paginated list of credit notes with filter chips.
 *
 * Filters per dispatch §5.3b: q (client-side over credit_note_number),
 * customer_id, invoice_id, status (4 values), from/to (issue_date).
 *
 * Cap-gates "New credit note" on `credit_notes.write`.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { CreditNoteStatusBadge } from '@/components/credit-notes/CreditNoteStatusBadge';
import { ExportButton } from '@/components/exports/ExportButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { formatMoney } from '@/lib/money';
import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import { listCreditNotes, type CreditNoteListFilters } from '@/lib/services/creditNotesService';
import { CreditNoteStatusSchema, type CreditNoteStatus } from '@/lib/types';

const STATUS_VALUES: readonly CreditNoteStatus[] = CreditNoteStatusSchema.options;

export default function CreditNotesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const customerId = searchParams.get('customer_id') ?? '';
  const invoiceId = searchParams.get('invoice_id') ?? '';
  const status = searchParams.get('status') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('credit_notes.write');

  const filters: CreditNoteListFilters = {};
  if (customerId) filters.customer_id = customerId;
  if (invoiceId) filters.invoice_id = invoiceId;
  if (status) filters.status = status;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: creditNoteKeys.list(filters),
    queryFn: () => listCreditNotes(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  // Client-side filters BE list does not yet expose.
  const items = (query.data?.items ?? []).filter((cn) => {
    if (from && cn.issue_date < from) return false;
    if (to && cn.issue_date > to) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (!cn.credit_note_number.toLowerCase().includes(needle)) return false;
    }
    return true;
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    if (
      'q' in next ||
      'customer_id' in next ||
      'invoice_id' in next ||
      'status' in next ||
      'from' in next ||
      'to' in next
    ) {
      sp.delete('cursor');
    }
    setSearchParams(sp, { replace: true });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Credit notes</h1>
          <p className="text-sm text-fg-muted">
            Issue and apply credits against customer invoices.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="credit_notes" />
          {canWrite && (
            <Link
              to="/credit-notes/new"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="new-credit-note-link"
            >
              New credit note
            </Link>
          )}
        </div>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Credit note filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="cn-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="cn-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Credit note #"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cn-status" className="text-xs uppercase tracking-wide text-fg-subtle">
            Status
          </label>
          <select
            id="cn-status"
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
          <label htmlFor="cn-customer" className="text-xs uppercase tracking-wide text-fg-subtle">
            Customer ID
          </label>
          <input
            id="cn-customer"
            type="text"
            value={customerId}
            onChange={(e) => update({ customer_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cn-invoice" className="text-xs uppercase tracking-wide text-fg-subtle">
            Invoice ID
          </label>
          <input
            id="cn-invoice"
            type="text"
            value={invoiceId}
            onChange={(e) => update({ invoice_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cn-from" className="text-xs uppercase tracking-wide text-fg-subtle">
            From
          </label>
          <input
            id="cn-from"
            type="date"
            value={from}
            onChange={(e) => update({ from: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cn-to" className="text-xs uppercase tracking-wide text-fg-subtle">
            To
          </label>
          <input
            id="cn-to"
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

      {query.isLoading && <TableSkeleton rows={6} cols={6} />}
      {query.error && <ErrorState title="Could not load credit notes" error={query.error} />}
      {query.data && items.length === 0 && (
        <EmptyState
          title="No credit notes found"
          description={
            q || customerId || invoiceId || status || from || to
              ? 'Try clearing filters.'
              : canWrite
                ? 'Create your first credit note to get started.'
                : 'Credit notes will appear here when accounting issues them.'
          }
        />
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Credit note #
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Customer
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Invoice
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Issued
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Applied
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((cn) => (
                <tr key={cn.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/credit-notes/${cn.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {cn.credit_note_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <CreditNoteStatusBadge status={cn.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link to={`/crm/customers/${cn.customer_id}`} className="text-brand hover:underline">
                      {cn.customer_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {cn.invoice_id ? (
                      <Link to={`/invoices/${cn.invoice_id}`} className="text-brand hover:underline">
                        {cn.invoice_id.slice(0, 8)}…
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(cn.issue_date)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(cn.amount_cents, { currency: cn.currency_code })}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(cn.applied_cents, { currency: cn.currency_code })}
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

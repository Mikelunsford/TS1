/**
 * PaymentsListPage — paginated list of payments with filter chips.
 *
 * Filters per dispatch §5.3b: q (passed through as the SPA-side search;
 * the BE list does not yet support fulltext, so q is a UI hint and is
 * dropped from the request), customer_id, invoice_id, payment_method_id
 * (client-side filter — BE does not surface this filter yet), and
 * from/to (paid_at range).
 *
 * Cap-gates "Record payment" on `payments.write`; the list itself
 * requires `payments.read` (server enforces, SPA hides the button only).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { formatMoney } from '@/lib/money';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { listPayments, type PaymentListFilters } from '@/lib/services/paymentsService';

export default function PaymentsListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const customerId = searchParams.get('customer_id') ?? '';
  const invoiceId = searchParams.get('invoice_id') ?? '';
  const paymentMethodId = searchParams.get('payment_method_id') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const q = searchParams.get('q') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('payments.write');

  const filters: PaymentListFilters = {};
  if (customerId) filters.customer_id = customerId;
  if (invoiceId) filters.invoice_id = invoiceId;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: paymentKeys.list(filters),
    queryFn: () => listPayments(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  // Client-side filters that the BE list does not natively support yet.
  const items = (query.data?.items ?? []).filter((p) => {
    if (paymentMethodId && p.payment_method_id !== paymentMethodId) return false;
    if (q) {
      const needle = q.toLowerCase();
      if (
        !p.payment_number.toLowerCase().includes(needle) &&
        !(p.reference ?? '').toLowerCase().includes(needle) &&
        !(p.description ?? '').toLowerCase().includes(needle)
      )
        return false;
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
      'payment_method_id' in next ||
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
          <h1 className="text-2xl font-semibold">Payments</h1>
          <p className="text-sm text-fg-muted">
            Record and review customer payments across invoices.
          </p>
        </div>
        {canWrite && (
          <Link
            to="/payments/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-payment-link"
          >
            Record payment
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Payment filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="payments-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="payments-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Payment # or reference"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payments-customer" className="text-xs uppercase tracking-wide text-fg-subtle">
            Customer ID
          </label>
          <input
            id="payments-customer"
            type="text"
            value={customerId}
            onChange={(e) => update({ customer_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payments-invoice" className="text-xs uppercase tracking-wide text-fg-subtle">
            Invoice ID
          </label>
          <input
            id="payments-invoice"
            type="text"
            value={invoiceId}
            onChange={(e) => update({ invoice_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payments-from" className="text-xs uppercase tracking-wide text-fg-subtle">
            Paid from
          </label>
          <input
            id="payments-from"
            type="date"
            value={from}
            onChange={(e) => update({ from: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="payments-to" className="text-xs uppercase tracking-wide text-fg-subtle">
            Paid to
          </label>
          <input
            id="payments-to"
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
      {query.error && <ErrorState title="Could not load payments" error={query.error} />}
      {query.data && items.length === 0 && (
        <EmptyState
          title="No payments found"
          description={
            q || customerId || invoiceId || from || to
              ? 'Try clearing filters.'
              : canWrite
                ? 'Record your first payment to get started.'
                : 'Payments will appear here when accounting records them.'
          }
        />
      )}

      {items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Payment #
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Invoice
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Paid at
                </th>
                <th scope="col" className="px-3 py-2 text-right font-medium">
                  Amount
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Reference
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/payments/${p.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {p.payment_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      to={`/invoices/${p.invoice_id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {p.invoice_id.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(p.paid_at)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(p.amount_cents, { currency: p.currency_code })}
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{p.reference ?? '—'}</td>
                  <td className="px-3 py-2">
                    {p.voided_at ? (
                      <span className="inline-flex items-center rounded-md bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-danger/30">
                        Voided
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
                        Posted
                      </span>
                    )}
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

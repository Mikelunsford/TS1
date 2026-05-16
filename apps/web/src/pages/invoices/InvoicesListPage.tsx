/**
 * InvoicesListPage — paginated list of invoices with multi-select status
 * chips + keyset cursor pagination. Mirrors QuotesListPage; the only real
 * structural difference is the chip-array status filter (the dispatch calls
 * out 9 chips: draft/pending/sent/partially_paid/paid/overdue/cancelled/
 * on_hold/refunded) and the extra columns (payment_status, balance).
 *
 * URL params drive filter state so each filter set is bookmarkable.
 *
 * See TS1/09-api/00-API-CONTRACT.md §6 (BE PR #46 merged 2026-05-16).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { PaymentStatusBadge } from '@/components/invoices/PaymentStatusBadge';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { listInvoices, type InvoiceListFilters } from '@/lib/services/invoicesService';
import { InvoiceStateSchema, type InvoiceState } from '@/lib/types';

const STATUS_VALUES: readonly InvoiceState[] = InvoiceStateSchema.options;

export default function InvoicesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const customerId = searchParams.get('customer_id') ?? '';
  const currencyCode = searchParams.get('currency_code') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  const canWrite = can('invoices.write');

  const filters: InvoiceListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (customerId) filters.customer_id = customerId;
  if (currencyCode) filters.currency_code = currencyCode;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (cursor) filters.cursor = cursor;

  const query = useQuery({
    queryKey: invoiceKeys.list(filters),
    queryFn: () => listInvoices(filters),
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });

  function update(next: Record<string, string | undefined>): void {
    const sp = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    // Reset cursor whenever a non-cursor filter changes.
    if (Object.keys(next).some((k) => k !== 'cursor')) sp.delete('cursor');
    setSearchParams(sp, { replace: true });
  }

  function toggleStatus(value: InvoiceState) {
    update({ status: status === value ? '' : value });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Invoices</h1>
          <p className="text-sm text-fg-muted">
            Manage customer invoices across their lifecycle.
          </p>
        </div>
        {canWrite && (
          <Link
            to="/invoices/new"
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
            data-testid="new-invoice-link"
          >
            New invoice
          </Link>
        )}
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Invoice filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="invoices-q" className="text-xs uppercase tracking-wide text-fg-subtle">
            Search
          </label>
          <input
            id="invoices-q"
            type="search"
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            placeholder="Invoice # or customer"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invoices-currency" className="text-xs uppercase tracking-wide text-fg-subtle">
            Currency
          </label>
          <input
            id="invoices-currency"
            type="text"
            maxLength={3}
            value={currencyCode}
            onChange={(e) => update({ currency_code: e.target.value.toUpperCase() })}
            placeholder="USD"
            className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-sm uppercase text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invoices-customer" className="text-xs uppercase tracking-wide text-fg-subtle">
            Customer ID
          </label>
          <input
            id="invoices-customer"
            type="text"
            value={customerId}
            onChange={(e) => update({ customer_id: e.target.value })}
            placeholder="(UUID)"
            className="w-64 rounded-md border border-border bg-bg px-2 py-1 font-mono text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invoices-from" className="text-xs uppercase tracking-wide text-fg-subtle">
            Issue from
          </label>
          <input
            id="invoices-from"
            type="date"
            value={from}
            onChange={(e) => update({ from: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="invoices-to" className="text-xs uppercase tracking-wide text-fg-subtle">
            Issue to
          </label>
          <input
            id="invoices-to"
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

      {/* Status chips — one click toggles. Single-select for now: the BE
          contract accepts a comma list but the UX is clearer with single. */}
      <div
        className="flex flex-wrap items-center gap-2"
        role="group"
        aria-label="Status filter"
        data-testid="status-chips"
      >
        {STATUS_VALUES.map((s) => {
          const active = status === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggleStatus(s)}
              aria-pressed={active}
              className={cn(
                'rounded-full border px-3 py-0.5 text-xs font-medium',
                active
                  ? 'border-brand bg-brand text-brand-fg'
                  : 'border-border bg-bg text-fg-muted hover:bg-bg-muted',
              )}
              data-testid={`status-chip-${s}`}
            >
              {s}
            </button>
          );
        })}
      </div>

      {query.isLoading && <TableSkeleton rows={6} cols={7} />}
      {query.error && <ErrorState title="Could not load invoices" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No invoices found"
          description={
            q || status || customerId || currencyCode || from || to
              ? 'Try clearing filters to see all invoices.'
              : canWrite
                ? 'Create your first invoice to get started.'
                : 'Invoices will appear here once accounting adds them.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Invoice #</th>
                <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Payment</th>
                <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                <th scope="col" className="px-3 py-2 font-medium">Due</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((inv) => (
                <tr key={inv.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/invoices/${inv.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {inv.invoice_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{inv.customer_name_snapshot}</td>
                  <td className="px-3 py-2">
                    <InvoiceStatusBadge status={inv.status} />
                  </td>
                  <td className="px-3 py-2">
                    <PaymentStatusBadge status={inv.payment_status} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(inv.issue_date)}</td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(inv.due_date)}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={inv.total_cents} currency={inv.currency_code} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={inv.balance_cents} currency={inv.currency_code} />
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

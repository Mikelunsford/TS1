/**
 * ExpenseListPage — all-expenses view for accounting. MyExpensesPage
 * delegates here with `me=true` baked in. Six-state status chips
 * (no `cancelled` — rejected rows are re-edited and resubmitted).
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { ExpenseStatusBadge } from '@/components/expenses/ExpenseStatusBadge';
import { ExportButton } from '@/components/exports/ExportButton';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { expenseKeys } from '@/lib/queryKeys/expenses';
import { listExpenses, type ExpenseListFilters } from '@/lib/services/expensesService';
import type { ExpenseState } from '@/lib/workflow';

const STATUS_VALUES: readonly ExpenseState[] = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'paid',
];

interface Props {
  /** When true, locks the `me=true` filter on the BE query (MyExpensesPage). */
  scopedToMe?: boolean;
  /** Override the page title. */
  title?: string;
  description?: string;
}

export default function ExpenseListPage({
  scopedToMe = false,
  title = 'Expenses',
  description = 'Approve and reimburse staff expenses.',
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';
  const status = searchParams.get('status') ?? '';
  const categoryId = searchParams.get('category_id') ?? '';
  const from = searchParams.get('from') ?? '';
  const to = searchParams.get('to') ?? '';
  const cursor = searchParams.get('cursor') ?? undefined;

  const [qInput, setQInput] = useState(q);
  const { can } = useCapabilities();
  // Anyone can submit their own expenses.
  const canWrite = can('expenses.write') || can('expenses.submit');

  const filters: ExpenseListFilters = {};
  if (q) filters.q = q;
  if (status) filters.status = status;
  if (categoryId) filters.category_id = categoryId;
  if (from) filters.from = from;
  if (to) filters.to = to;
  if (cursor) filters.cursor = cursor;
  if (scopedToMe) filters.me = true;

  const query = useQuery({
    queryKey: expenseKeys.list(filters),
    queryFn: () => listExpenses(filters),
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

  function toggleStatus(value: ExpenseState) {
    update({ status: status === value ? '' : value });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-fg-muted">{description}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportButton entity="expenses" />
          {canWrite && (
            <Link
              to="/expenses/new"
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
              data-testid="new-expense-link"
            >
              New expense
            </Link>
          )}
        </div>
      </header>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        aria-label="Expense filters"
        onSubmit={(e) => {
          e.preventDefault();
          update({ q: qInput });
        }}
      >
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Expense # or description"
          className="w-64 rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Search"
        />
        <input
          type="date"
          value={from}
          onChange={(e) => update({ from: e.target.value })}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Spent from"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => update({ to: e.target.value })}
          className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          aria-label="Spent to"
        />
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90"
        >
          Apply
        </button>
      </form>

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

      {query.isLoading && <TableSkeleton rows={6} cols={6} />}
      {query.error && <ErrorState title="Could not load expenses" error={query.error} />}
      {query.data && query.data.items.length === 0 && (
        <EmptyState
          title="No expenses found"
          description={
            scopedToMe
              ? 'Submit your first expense.'
              : 'Expenses will appear here once submitted.'
          }
        />
      )}

      {query.data && query.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Expense #</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Description</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {query.data.items.map((e) => (
                <tr key={e.id} className="hover:bg-bg-muted">
                  <td className="px-3 py-2 font-mono">
                    <Link
                      to={`/expenses/${e.id}`}
                      className="text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                    >
                      {e.expense_number}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <ExpenseStatusBadge status={e.status} />
                  </td>
                  <td className="px-3 py-2 text-fg-muted">{formatDate(e.spent_at)}</td>
                  <td className="px-3 py-2 text-fg-muted">{e.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={e.amount_cents} currency={e.currency_code} />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={e.total_cents} currency={e.currency_code} />
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

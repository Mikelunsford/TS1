/**
 * Expense-by-category report — Wave 10 / Phase 18 polish.
 * Date-range × currency. One row per expense category with totals.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { CurrencyPicker } from '@/components/inventory/CurrencyPicker';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { DateRangePicker } from '@/components/reports/DateRangePicker';
import { ReportExportButton } from '@/components/reports/ReportExportButton';
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { reportKeys } from '@/lib/queryKeys/reports';
import { getExpenseByCategoryReport } from '@/lib/services/reportsService';
import type { ExpenseByCategoryRow } from '@/lib/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function firstOfMonth(today: string): string {
  return `${today.slice(0, 8)}01`;
}

export default function ExpenseByCategoryReportPage() {
  const today = todayIso();
  const [range, setRange] = useState({ start: firstOfMonth(today), end: today });
  const [currency, setCurrency] = useState('USD');

  const validRange = Boolean(range.start && range.end && range.end >= range.start);
  const query = useQuery({
    queryKey: reportKeys.expenseByCategory(range.start, range.end, currency),
    queryFn: () => getExpenseByCategoryReport(range.start, range.end, currency),
    staleTime: 30_000,
    enabled: validRange && Boolean(currency),
  });

  const columns: Array<ReportColumn<ExpenseByCategoryRow>> = [
    { key: 'cat', header: 'Category', render: (r) => r.category_name },
    {
      key: 'count',
      header: 'Expenses',
      align: 'right',
      render: (r) => r.expense_count,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.total_cents} currency={currency} />,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Expenses by category</h1>
          <p className="text-sm text-fg-muted">
            Approved/paid expenses grouped by category within the selected date range.
          </p>
        </div>
        <ReportExportButton reportKey="expense-by-category" />
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-bg-muted/30 px-3 py-2">
        <DateRangePicker start={range.start} end={range.end} onChange={setRange} />
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>Currency</span>
          <CurrencyPicker value={currency} onChange={(c) => setCurrency(c ?? 'USD')} />
        </label>
      </div>

      {!validRange && (
        <ErrorState title="Invalid date range" error="End date must be on or after the start date." />
      )}
      {validRange && query.isLoading && <TableSkeleton rows={5} cols={3} />}
      {validRange && query.error && (
        <ErrorState title="Could not load expenses by category" error={query.error} />
      )}
      {validRange && query.data && query.data.rows.length === 0 && (
        <EmptyState title="No expenses in this range" description="No matching expenses were found for the selected period and currency." />
      )}
      {validRange && query.data && query.data.rows.length > 0 && (
        <ReportTable<ExpenseByCategoryRow>
          columns={columns}
          rows={query.data.rows}
          rowKey={(r, i) => r.category_id ?? `cat-${i}`}
          testIdPrefix="exp-cat-row"
          footer={[
            'Totals',
            query.data.total_expense_count,
            <MoneyDisplay key="t" cents={query.data.total_expenses_cents} currency={currency} />,
          ]}
        />
      )}
    </div>
  );
}

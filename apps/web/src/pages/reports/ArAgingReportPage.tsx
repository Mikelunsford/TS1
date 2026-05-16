/**
 * AR Aging report — Wave 10 / Phase 18 polish.
 * Snapshot ("as of") report with customer rows × 5 aging buckets.
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { CurrencyPicker } from '@/components/inventory/CurrencyPicker';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { DatePicker } from '@/components/reports/DateRangePicker';
import { ReportExportButton } from '@/components/reports/ReportExportButton';
import { ReportTable, type ReportColumn } from '@/components/reports/ReportTable';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { reportKeys } from '@/lib/queryKeys/reports';
import { getArAgingReport } from '@/lib/services/reportsService';
import type { ArAgingRow } from '@/lib/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ArAgingReportPage() {
  const [asOf, setAsOf] = useState(todayIso());
  const [currency, setCurrency] = useState('USD');

  const query = useQuery({
    queryKey: reportKeys.arAging(asOf, currency),
    queryFn: () => getArAgingReport(asOf, currency),
    staleTime: 30_000,
    enabled: Boolean(asOf && currency),
  });

  const columns: Array<ReportColumn<ArAgingRow>> = [
    { key: 'customer', header: 'Customer', render: (r) => r.customer_name },
    {
      key: 'current',
      header: 'Current',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.current_cents} currency={currency} />,
    },
    {
      key: '1_30',
      header: '1–30',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.days_1_30_cents} currency={currency} />,
    },
    {
      key: '31_60',
      header: '31–60',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.days_31_60_cents} currency={currency} />,
    },
    {
      key: '61_90',
      header: '61–90',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.days_61_90_cents} currency={currency} />,
    },
    {
      key: 'over_90',
      header: 'Over 90',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.days_over_90_cents} currency={currency} />,
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.total_cents} currency={currency} />,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">AR aging</h1>
          <p className="text-sm text-fg-muted">
            Outstanding receivables by customer, bucketed by days past due as of the selected date.
          </p>
        </div>
        <ReportExportButton reportKey="ar-aging" params={{ as_of: asOf, currency }} />
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-bg-muted/30 px-3 py-2">
        <DatePicker value={asOf} onChange={setAsOf} label="As of" />
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>Currency</span>
          <CurrencyPicker value={currency} onChange={(c) => setCurrency(c ?? 'USD')} />
        </label>
      </div>

      {query.isLoading && <TableSkeleton rows={6} cols={8} />}
      {query.error && <ErrorState title="Could not load AR aging" error={query.error} />}
      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="No outstanding receivables" description="Every customer is paid up as of the selected date." />
      )}
      {query.data && query.data.rows.length > 0 && (
        <ReportTable<ArAgingRow>
          columns={columns}
          rows={query.data.rows}
          rowKey={(r) => r.customer_id}
          testIdPrefix="ar-aging-row"
          footer={[
            'Totals',
            <MoneyDisplay key="t1" cents={query.data.total_current_cents} currency={currency} />,
            <MoneyDisplay key="t2" cents={query.data.total_days_1_30_cents} currency={currency} />,
            <MoneyDisplay key="t3" cents={query.data.total_days_31_60_cents} currency={currency} />,
            <MoneyDisplay key="t4" cents={query.data.total_days_61_90_cents} currency={currency} />,
            <MoneyDisplay key="t5" cents={query.data.total_days_over_90_cents} currency={currency} />,
            <MoneyDisplay key="t6" cents={query.data.total_outstanding_cents} currency={currency} />,
          ]}
        />
      )}
    </div>
  );
}

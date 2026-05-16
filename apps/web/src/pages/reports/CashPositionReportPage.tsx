/**
 * Cash position report — Wave 10 / Phase 18 polish.
 * Snapshot ("as of") report listing cash + bank account balances.
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
import { getCashPositionReport } from '@/lib/services/reportsService';
import type { CashPositionRow } from '@/lib/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function CashPositionReportPage() {
  const [asOf, setAsOf] = useState(todayIso());
  const [currency, setCurrency] = useState('USD');

  const query = useQuery({
    queryKey: reportKeys.cashPosition(asOf, currency),
    queryFn: () => getCashPositionReport(asOf, currency),
    staleTime: 30_000,
    enabled: Boolean(asOf && currency),
  });

  const columns: Array<ReportColumn<CashPositionRow>> = [
    { key: 'code', header: 'Code', render: (r) => <span className="font-mono">{r.account_code}</span> },
    { key: 'name', header: 'Account', render: (r) => r.account_name },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right',
      render: (r) => <MoneyDisplay cents={r.balance_cents} currency={currency} />,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">Cash position</h1>
          <p className="text-sm text-fg-muted">
            Cash and bank account balances as of the selected date.
          </p>
        </div>
        <ReportExportButton reportKey="cash-position" />
      </header>

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-bg-muted/30 px-3 py-2">
        <DatePicker value={asOf} onChange={setAsOf} label="As of" />
        <label className="flex flex-col gap-1 text-xs text-fg-muted">
          <span>Currency</span>
          <CurrencyPicker value={currency} onChange={(c) => setCurrency(c ?? 'USD')} />
        </label>
      </div>

      {query.isLoading && <TableSkeleton rows={4} cols={3} />}
      {query.error && <ErrorState title="Could not load cash position" error={query.error} />}
      {query.data && query.data.rows.length === 0 && (
        <EmptyState title="No cash accounts" description="No active cash or bank accounts exist for the selected currency." />
      )}
      {query.data && query.data.rows.length > 0 && (
        <ReportTable<CashPositionRow>
          columns={columns}
          rows={query.data.rows}
          rowKey={(r) => r.account_id}
          testIdPrefix="cash-row"
          footer={[
            'Total cash',
            '',
            <MoneyDisplay key="t" cents={query.data.total_cash_cents} currency={currency} />,
          ]}
        />
      )}
    </div>
  );
}

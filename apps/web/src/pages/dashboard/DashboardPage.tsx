/**
 * DashboardPage — Wave 10 / Phase 18 polish.
 *
 * Renders 4 KPI tiles for the active org from
 *   GET /dashboard-api/dashboard/summary
 * The aggregator fans out to the ar_aging + cash_position + profit_loss
 * SECURITY DEFINER RPCs (migrations 0067 + 0062) and computes today's
 * snapshot + MTD totals in the caller's default currency.
 *
 * Tile grid uses a simple 4-column layout that collapses to 2 on md and
 * 1 on sm. No third-party chart dep; pure formatted numbers + bucket
 * breakdown for AR aging.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { dashboardKeys } from '@/lib/queryKeys/reports';
import { getDashboardSummary } from '@/lib/services/reportsService';

export default function DashboardPage() {
  const query = useQuery({
    queryKey: dashboardKeys.summary(),
    queryFn: getDashboardSummary,
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-fg-muted">
          Live KPIs across receivables, cash, and month-to-date P&amp;L.
        </p>
      </header>

      {query.isLoading && (
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
          data-testid="dashboard-loading"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}
      {query.error && <ErrorState title="Could not load dashboard" error={query.error} />}
      {query.data && (
        <>
          <div
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"
            data-testid="dashboard-tile-grid"
          >
            <Tile
              title="Cash on hand"
              testId="tile-cash-on-hand"
              footer={`as of ${query.data.as_of}`}
            >
              <MoneyDisplay
                cents={query.data.cash_on_hand_cents}
                currency={query.data.currency}
                className="text-2xl font-semibold"
              />
            </Tile>

            <Tile
              title="MTD revenue"
              testId="tile-mtd-revenue"
              footer={`${query.data.period_start} – ${query.data.period_end}`}
            >
              <MoneyDisplay
                cents={query.data.mtd_revenue_cents}
                currency={query.data.currency}
                className="text-2xl font-semibold"
              />
            </Tile>

            <Tile
              title="MTD expense"
              testId="tile-mtd-expense"
              footer={`${query.data.period_start} – ${query.data.period_end}`}
            >
              <MoneyDisplay
                cents={query.data.mtd_expense_cents}
                currency={query.data.currency}
                className="text-2xl font-semibold"
              />
            </Tile>

            <Tile
              title="AR outstanding"
              testId="tile-ar-aging-summary"
              footer={
                <Link to="/reports/ar-aging" className="text-brand hover:underline">
                  View AR aging report →
                </Link>
              }
            >
              <ArAgingBuckets
                summary={query.data.ar_aging_summary}
                currency={query.data.currency}
              />
            </Tile>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({
  title,
  children,
  footer,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  testId: string;
}) {
  return (
    <section
      className="rounded-md border border-border bg-bg p-4 shadow-sm"
      data-testid={testId}
    >
      <p className="text-xs uppercase tracking-wide text-fg-subtle">{title}</p>
      <div className="mt-2">{children}</div>
      {footer && <p className="mt-3 text-xs text-fg-muted">{footer}</p>}
    </section>
  );
}

function ArAgingBuckets({
  summary,
  currency,
}: {
  summary: {
    current_cents: number;
    days_1_30_cents: number;
    days_31_60_cents: number;
    days_61_90_cents: number;
    days_over_90_cents: number;
  };
  currency: string;
}) {
  const total =
    summary.current_cents +
    summary.days_1_30_cents +
    summary.days_31_60_cents +
    summary.days_61_90_cents +
    summary.days_over_90_cents;
  const rows: Array<[string, number, string]> = [
    ['Current', summary.current_cents, 'aging-current'],
    ['1–30', summary.days_1_30_cents, 'aging-1-30'],
    ['31–60', summary.days_31_60_cents, 'aging-31-60'],
    ['61–90', summary.days_61_90_cents, 'aging-61-90'],
    ['Over 90', summary.days_over_90_cents, 'aging-over-90'],
  ];
  return (
    <div className="space-y-1">
      <MoneyDisplay cents={total} currency={currency} className="text-2xl font-semibold" />
      <ul className="mt-2 space-y-0.5 text-xs text-fg-muted">
        {rows.map(([label, cents, testId]) => (
          <li key={label} className="flex justify-between gap-3" data-testid={testId}>
            <span>{label}</span>
            <MoneyDisplay cents={cents} currency={currency} className="font-mono" />
          </li>
        ))}
      </ul>
    </div>
  );
}

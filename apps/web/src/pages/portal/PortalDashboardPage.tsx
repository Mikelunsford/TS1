import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CreditCard, FileText, Receipt } from 'lucide-react';

import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { portalKeys } from '@/lib/queryKeys/portal';
import {
  getPortalMe,
  getPortalStatement,
  listPortalInvoices,
} from '@/lib/services/portalService';

/**
 * /portal — portal home. Four-tile dashboard: outstanding balance,
 * most-recent invoice, most-recent project status, quick-action links.
 *
 * Phase 21 (Wave 10 Session 4).
 */
export default function PortalDashboardPage() {
  const me = useQuery({ queryKey: portalKeys.me(), queryFn: getPortalMe, staleTime: 60_000 });
  const statement = useQuery({
    queryKey: portalKeys.statement(null, null),
    queryFn: () => getPortalStatement(),
    staleTime: 60_000,
  });
  const recent = useQuery({
    queryKey: portalKeys.invoiceList({ page_size: 5 }),
    queryFn: () => listPortalInvoices({ page_size: 5 }),
    staleTime: 60_000,
  });

  const customerName =
    (me.data?.customer as { display_name?: string } | undefined)?.display_name ?? 'Welcome';
  const outstanding = statement.data?.aging.total_cents ?? 0;
  const currency = statement.data?.currency_code ?? 'USD';
  const recentInvoice = recent.data?.items[0] as
    | (Record<string, unknown> & { invoice_number?: string; total_cents?: number; status?: string; issue_date?: string })
    | undefined;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">{customerName}</h1>
        <p className="text-fg-muted">Your account at a glance.</p>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <KpiTile
          title="Outstanding balance"
          value={formatMoney(outstanding, { currency })}
          subtitle={statement.data ? `As of ${formatDate(statement.data.as_of)}` : '—'}
          to="/portal/statement"
          icon={CreditCard}
        />
        <KpiTile
          title="Latest invoice"
          value={recentInvoice?.invoice_number ?? '—'}
          subtitle={
            recentInvoice
              ? `${formatMoney(recentInvoice.total_cents ?? 0, { currency: (recentInvoice as { currency_code?: string }).currency_code ?? currency })} · ${recentInvoice.status ?? ''}`
              : 'No invoices yet'
          }
          to={recentInvoice ? `/portal/invoices/${(recentInvoice as { id: string }).id}` : '/portal/invoices'}
          icon={Receipt}
        />
        <KpiTile
          title="Recent activity"
          value={recent.data ? String(recent.data.items.length) : '—'}
          subtitle="Recent invoices in last batch"
          to="/portal/invoices"
          icon={FileText}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wide text-fg-subtle">
          Quick actions
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <QuickLink to="/portal/invoices" label="View invoices" />
          <QuickLink to="/portal/quotes" label="Review quotes" />
          <QuickLink to="/portal/projects" label="Project status" />
          <QuickLink to="/portal/payments" label="Payment history" />
        </div>
      </section>
    </div>
  );
}

function KpiTile({
  title,
  value,
  subtitle,
  to,
  icon: Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  to: string;
  icon: typeof Receipt;
}) {
  return (
    <Link
      to={to}
      className="block rounded-md border border-border bg-bg p-4 hover:bg-bg-subtle"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-fg-subtle">{title}</span>
        <Icon className="h-4 w-4 text-fg-muted" />
      </div>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-sm text-fg-muted">{subtitle}</p>
    </Link>
  );
}

function QuickLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm hover:bg-bg"
    >
      <span>{label}</span>
      <ArrowRight className="h-4 w-4 text-fg-muted" />
    </Link>
  );
}

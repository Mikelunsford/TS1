import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ActivityFeed } from '@/components/crm/ActivityFeed';
import { CustomerOverviewCard } from '@/components/crm/CustomerOverviewCard';
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge';
import { ProjectStatusBadge } from '@/components/projects/ProjectStatusBadge';
import { QuoteStatusBadge } from '@/components/quotes/QuoteStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn, formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { contactKeys, customerKeys } from '@/lib/queryKeys/crm';
import { invoiceKeys } from '@/lib/queryKeys/invoices';
import { projectKeys } from '@/lib/queryKeys/projects';
import { quoteKeys } from '@/lib/queryKeys/quotes';
import { getCustomer } from '@/lib/services/customersService';
import { listContacts } from '@/lib/services/contactsService';
import { listInvoices } from '@/lib/services/invoicesService';
import { listProjects } from '@/lib/services/projectsService';
import { listQuotes } from '@/lib/services/quotesService';
// Customer payments + credit notes (Wave 5 / 5.3b) — FE-B owns this block.
import { CustomerCreditNotesTab, CustomerPaymentsTab } from './CustomerFinanceTabs';
// end customer payments + credit notes block.
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CommentsTab } from '@/components/collaboration/CommentsTab';
import { FilesTab } from '@/components/collaboration/FilesTab';
// End Phase 16 (Wave 10 Session 2).

type TabKey =
  | 'overview'
  | 'contacts'
  | 'activities'
  | 'quotes'
  | 'projects'
  | 'invoices'
  | 'payments'
  | 'credit_notes'
  | 'files'
  | 'comments';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'activities', label: 'Activities' },
  { key: 'quotes', label: 'Quotes' },
  { key: 'projects', label: 'Projects' },
  { key: 'invoices', label: 'Invoices' },
  // Customer payments + credit notes (Wave 5 / 5.3b) — FE-B owns this block.
  { key: 'payments', label: 'Payments' },
  { key: 'credit_notes', label: 'Credit notes' },
  // end customer payments + credit notes block.
  // Phase 16 (Wave 10 Session 2) — B1 owns this block.
  { key: 'comments', label: 'Comments' },
  { key: 'files', label: 'Files' },
  // End Phase 16 (Wave 10 Session 2).
];

/**
 * Customer detail with tabbed surface. Each tab renders a filtered list
 * scoped to this customer.
 */
export default function CustomerDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [tab, setTab] = useState<TabKey>('overview');

  const customerQuery = useQuery({
    queryKey: customerKeys.byId(id),
    queryFn: () => getCustomer(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/crm/customers" className="hover:underline">
          Customers
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{customerQuery.data?.display_name ?? '…'}</span>
      </nav>

      {customerQuery.isLoading && <Skeleton className="h-40 w-full" />}
      {customerQuery.error && (
        <ErrorState title="Could not load customer" error={customerQuery.error} />
      )}
      {customerQuery.data && <CustomerOverviewCard customer={customerQuery.data} />}

      <div className="border-b border-border" role="tablist" aria-label="Customer sections">
        <div className="-mb-px flex flex-wrap gap-1">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                aria-controls={`tab-panel-${t.key}`}
                id={`tab-${t.key}`}
                onClick={() => setTab(t.key)}
                className={cn(
                  'border-b-2 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand',
                  active
                    ? 'border-brand font-medium text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <section
        id={`tab-panel-${tab}`}
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        className="min-h-[8rem]"
      >
        {tab === 'overview' && (
          <p className="text-sm text-fg-muted">
            Detailed business info, billing preferences, and audit trail land in later phases.
          </p>
        )}
        {tab === 'contacts' && id && <CustomerContactsTab customerId={id} />}
        {tab === 'activities' && id && (
          <ActivityFeed entity_type="customer" entity_id={id} />
        )}
        {tab === 'quotes' && id && <CustomerQuotesTab customerId={id} />}
        {tab === 'projects' && id && <CustomerProjectsTab customerId={id} />}
        {tab === 'invoices' && id && <CustomerInvoicesTab customerId={id} />}
        {/* Customer payments + credit notes (Wave 5 / 5.3b) — FE-B owns this block. */}
        {tab === 'payments' && id && <CustomerPaymentsTab customerId={id} />}
        {tab === 'credit_notes' && id && <CustomerCreditNotesTab customerId={id} />}
        {/* end customer payments + credit notes block. */}
        {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
        {tab === 'comments' && id && <CommentsTab entityType="customer" entityId={id} />}
        {tab === 'files' && id && <FilesTab entityType="customer" entityId={id} />}
        {/* End Phase 16 (Wave 10 Session 2). */}
      </section>
    </div>
  );
}

function CustomerContactsTab({ customerId }: { customerId: string }) {
  const query = useQuery({
    queryKey: contactKeys.byCustomer(customerId),
    queryFn: () => listContacts({ customer_id: customerId }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load contacts" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No contacts yet"
        description="Add primary and secondary points of contact for this customer."
      />
    );
  }

  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2 text-sm">
          <span className="font-medium text-fg">
            {[c.first_name, c.last_name].filter(Boolean).join(' ')}
          </span>
          {c.title && <span className="text-fg-muted">{c.title}</span>}
          {c.email && (
            <a className="text-brand hover:underline" href={`mailto:${c.email}`}>
              {c.email}
            </a>
          )}
          {c.phone && <span className="text-fg-muted">{c.phone}</span>}
          {c.is_primary && (
            <span className="ml-auto text-xs uppercase tracking-wide text-fg-subtle">Primary</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function CustomerQuotesTab({ customerId }: { customerId: string }) {
  const query = useQuery({
    queryKey: quoteKeys.list({ customer_id: customerId }),
    queryFn: () => listQuotes({ customer_id: customerId }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load quotes" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No quotes yet"
        description="Quotes scoped to this customer will appear here."
        action={
          <Link
            to={`/quotes/new?customer_id=${customerId}`}
            className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Create quote
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Quote #</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Valid until</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((q) => (
            <tr key={q.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 font-mono">
                <Link to={`/quotes/${q.id}`} className="text-brand hover:underline">
                  {q.quote_number}
                </Link>
              </td>
              <td className="px-3 py-2">
                <QuoteStatusBadge status={q.status} />
              </td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(q.valid_until)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(q.total_cents, { currency: q.currency_code })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerProjectsTab({ customerId }: { customerId: string }) {
  const query = useQuery({
    queryKey: projectKeys.list({ customer_id: customerId }),
    queryFn: () => listProjects({ customer_id: customerId }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load projects" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Projects scoped to this customer will appear here."
        action={
          <Link
            to={`/projects/new?customer_id=${customerId}`}
            className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Create project
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Project #</th>
            <th scope="col" className="px-3 py-2 font-medium">Name</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Due</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((p) => (
            <tr key={p.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 font-mono">
                <Link to={`/projects/${p.id}`} className="text-brand hover:underline">
                  {p.project_number}
                </Link>
              </td>
              <td className="px-3 py-2 text-fg">{p.name}</td>
              <td className="px-3 py-2">
                <ProjectStatusBadge status={p.status} />
              </td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(p.due_date)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(p.total_cents, { currency: p.currency_code })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerInvoicesTab({ customerId }: { customerId: string }) {
  const query = useQuery({
    queryKey: invoiceKeys.list({ customer_id: customerId }),
    queryFn: () => listInvoices({ customer_id: customerId }),
    staleTime: 15_000,
  });

  if (query.isLoading) return <Skeleton className="h-24 w-full" />;
  if (query.error) return <ErrorState title="Could not load invoices" error={query.error} />;
  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No invoices yet"
        description="Invoices scoped to this customer will appear here."
        action={
          <Link
            to={`/invoices/new?customer_id=${customerId}`}
            className="inline-flex items-center rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg hover:opacity-90"
          >
            Create invoice
          </Link>
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Invoice #</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Issued</th>
            <th scope="col" className="px-3 py-2 font-medium">Due</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((inv) => (
            <tr key={inv.id} className="hover:bg-bg-muted">
              <td className="px-3 py-2 font-mono">
                <Link to={`/invoices/${inv.id}`} className="text-brand hover:underline">
                  {inv.invoice_number}
                </Link>
              </td>
              <td className="px-3 py-2">
                <InvoiceStatusBadge status={inv.status} />
              </td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(inv.issue_date)}</td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(inv.due_date)}</td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(inv.total_cents, { currency: inv.currency_code })}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatMoney(inv.balance_cents ?? 0, { currency: inv.currency_code })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

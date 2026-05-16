import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ActivityFeed } from '@/components/crm/ActivityFeed';
import { CustomerOverviewCard } from '@/components/crm/CustomerOverviewCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/format';
import { contactKeys, customerKeys } from '@/lib/queryKeys/crm';
import { getCustomer } from '@/lib/services/customersService';
import { listContacts } from '@/lib/services/contactsService';
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

const TABS: Array<{ key: TabKey; label: string; deferred?: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'activities', label: 'Activities' },
  { key: 'quotes', label: 'Quotes', deferred: 'Phase 3' },
  { key: 'projects', label: 'Projects', deferred: 'Phase 3' },
  { key: 'invoices', label: 'Invoices', deferred: 'Phase 3' },
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
 * Customer detail with tabbed surface. Only Overview / Contacts / Activities
 * are wired in Wave 2; the rest render a deferred placeholder pointing at
 * the wave that ships the data.
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
        {/* Customer payments + credit notes (Wave 5 / 5.3b) — FE-B owns this block. */}
        {tab === 'payments' && id && <CustomerPaymentsTab customerId={id} />}
        {tab === 'credit_notes' && id && <CustomerCreditNotesTab customerId={id} />}
        {/* end customer payments + credit notes block. */}
        {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
        {tab === 'comments' && id && <CommentsTab entityType="customer" entityId={id} />}
        {tab === 'files' && id && <FilesTab entityType="customer" entityId={id} />}
        {/* End Phase 16 (Wave 10 Session 2). */}
        {TABS.find((t) => t.key === tab)?.deferred && (
          <EmptyState
            title={`${TABS.find((t) => t.key === tab)?.label} — coming in ${TABS.find((t) => t.key === tab)?.deferred}`}
            description="This tab lights up when the upstream module ships."
          />
        )}
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

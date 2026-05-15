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

type TabKey = 'overview' | 'contacts' | 'activities' | 'quotes' | 'projects' | 'invoices' | 'files';

const TABS: Array<{ key: TabKey; label: string; deferred?: string }> = [
  { key: 'overview', label: 'Overview' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'activities', label: 'Activities' },
  { key: 'quotes', label: 'Quotes', deferred: 'Phase 3' },
  { key: 'projects', label: 'Projects', deferred: 'Phase 3' },
  { key: 'invoices', label: 'Invoices', deferred: 'Phase 3' },
  { key: 'files', label: 'Files', deferred: 'Phase 5' },
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

/**
 * LeadDetailPage — read-only lead detail surface with collaboration.
 *
 * Closes R-W10-S2-B1-OBS-02. Renders header (lead_number + status badge),
 * key fields (company, contact, owner, value, expected close), notes, and
 * the Wave-10 Phase-16 <CollaborationSection>.
 *
 * Conversion (lead → opportunity/customer) lives on the list page's
 * ConvertLeadDialog; this page is read-only / commentary surface.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
import { LeadStatusBadge } from '@/components/crm/LeadStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/formatDate';
import { formatMoney } from '@/lib/money';
import { leadKeys } from '@/lib/queryKeys/leads';
import { getLead } from '@/lib/services/leadsService';

export default function LeadDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const leadQuery = useQuery({
    queryKey: leadKeys.detail(id),
    queryFn: () => getLead(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const lead = leadQuery.data;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/crm/leads" className="hover:underline">
          Leads
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{lead?.lead_number ?? '…'}</span>
      </nav>

      {leadQuery.isLoading && <Skeleton className="h-40 w-full" />}
      {leadQuery.error && <ErrorState title="Could not load lead" error={leadQuery.error} />}
      {leadQuery.isSuccess && !lead && (
        <EmptyState title="Lead not found" description="It may have been deleted." />
      )}

      {lead && (
        <>
          <header className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{lead.display_name}</h1>
              <LeadStatusBadge status={lead.status} />
            </div>
            <p className="text-sm text-fg-muted">
              <span className="font-mono">{lead.lead_number}</span>
              {lead.company_name && <> · {lead.company_name}</>}
            </p>
          </header>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border bg-bg p-4 sm:grid-cols-2">
            <Field label="Source">
              {lead.source ? (
                <span className="capitalize">{lead.source}</span>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Owner">
              {lead.owner_user_id ? (
                <span className="font-mono text-xs">{lead.owner_user_id.slice(0, 8)}…</span>
              ) : (
                <span className="text-fg-muted">Unassigned</span>
              )}
            </Field>
            <Field label="Email">
              {lead.primary_email ? (
                <a
                  href={`mailto:${lead.primary_email}`}
                  className="text-brand hover:underline"
                >
                  {lead.primary_email}
                </a>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Phone">
              {lead.primary_phone ? (
                <a href={`tel:${lead.primary_phone}`} className="text-brand hover:underline">
                  {lead.primary_phone}
                </a>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Estimated value">
              {lead.estimated_value_cents > 0 ? (
                <>
                  {formatMoney(lead.estimated_value_cents, {
                    currency: lead.currency_code ?? 'USD',
                  })}
                </>
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Expected close">
              {lead.expected_close_date ? (
                formatDate(lead.expected_close_date)
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            {lead.converted_at && lead.converted_opportunity_id && (
              <Field label="Converted to">
                <Link
                  to={`/crm/opportunities/${lead.converted_opportunity_id}`}
                  className="text-brand hover:underline"
                >
                  Opportunity →
                </Link>
                <span className="ml-2 text-xs text-fg-muted">
                  {formatDate(lead.converted_at)}
                </span>
              </Field>
            )}
          </dl>

          {lead.notes && (
            <section className="rounded-md border border-border bg-bg p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Notes</h2>
              <p className="whitespace-pre-wrap text-sm">{lead.notes}</p>
            </section>
          )}

          <CollaborationSection entityType="lead" entityId={lead.id} />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

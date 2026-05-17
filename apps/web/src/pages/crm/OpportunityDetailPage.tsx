/**
 * OpportunityDetailPage — read-only opportunity detail surface with
 * collaboration.
 *
 * Closes R-W10-S2-B1-OBS-02. Renders header (opportunity_number + stage
 * badge), key fields (customer link, amount, probability, expected close,
 * lead origin if any), notes, and the Wave-10 Phase-16
 * <CollaborationSection>.
 *
 * Stage transitions live on the kanban (drag-and-drop) and the list
 * page's row actions; this page is read-only / commentary surface.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';

import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
import { OpportunityStageBadge } from '@/components/crm/OpportunityStageBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/formatDate';
import { formatMoney } from '@/lib/money';
import { opportunityKeys } from '@/lib/queryKeys/opportunities';
import { getOpportunity } from '@/lib/services/opportunitiesService';

export default function OpportunityDetailPage() {
  const { id = '' } = useParams<{ id: string }>();

  const oppQuery = useQuery({
    queryKey: opportunityKeys.detail(id),
    queryFn: () => getOpportunity(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const opp = oppQuery.data;
  const weightedCents =
    opp && opp.amount_cents > 0
      ? Math.round((opp.amount_cents * opp.probability_pct) / 100)
      : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/crm/opportunities" className="hover:underline">
          Opportunities
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{opp?.opportunity_number ?? '…'}</span>
      </nav>

      {oppQuery.isLoading && <Skeleton className="h-40 w-full" />}
      {oppQuery.error && (
        <ErrorState title="Could not load opportunity" error={oppQuery.error} />
      )}
      {oppQuery.isSuccess && !opp && (
        <EmptyState title="Opportunity not found" description="It may have been deleted." />
      )}

      {opp && (
        <>
          <header className="space-y-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold">{opp.display_name}</h1>
              <OpportunityStageBadge stage={opp.stage} />
            </div>
            <p className="text-sm text-fg-muted">
              <span className="font-mono">{opp.opportunity_number}</span>
            </p>
          </header>

          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border border-border bg-bg p-4 sm:grid-cols-2">
            <Field label="Customer">
              <Link
                to={`/crm/customers/${opp.customer_id}`}
                className="text-brand hover:underline"
              >
                View customer →
              </Link>
            </Field>
            <Field label="Owner">
              {opp.owner_user_id ? (
                <span className="font-mono text-xs">{opp.owner_user_id.slice(0, 8)}…</span>
              ) : (
                <span className="text-fg-muted">Unassigned</span>
              )}
            </Field>
            <Field label="Amount">
              {formatMoney(opp.amount_cents, { currency: opp.currency_code ?? 'USD' })}
            </Field>
            <Field label="Probability">
              {opp.probability_pct}
              <span aria-hidden>%</span>
            </Field>
            <Field label="Weighted">
              {weightedCents > 0 ? (
                formatMoney(weightedCents, { currency: opp.currency_code ?? 'USD' })
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            <Field label="Expected close">
              {opp.expected_close_date ? (
                formatDate(opp.expected_close_date)
              ) : (
                <span className="text-fg-muted">—</span>
              )}
            </Field>
            {opp.lead_id && (
              <Field label="Source lead">
                <Link to={`/crm/leads/${opp.lead_id}`} className="text-brand hover:underline">
                  View lead →
                </Link>
              </Field>
            )}
            {opp.closed_at && (
              <Field label="Closed">
                <time dateTime={opp.closed_at}>{formatDate(opp.closed_at)}</time>
                {opp.close_reason && (
                  <span className="ml-2 text-xs text-fg-muted">({opp.close_reason})</span>
                )}
              </Field>
            )}
          </dl>

          {opp.notes && (
            <section className="rounded-md border border-border bg-bg p-4">
              <h2 className="mb-2 text-xs uppercase tracking-wide text-fg-subtle">Notes</h2>
              <p className="whitespace-pre-wrap text-sm">{opp.notes}</p>
            </section>
          )}

          <CollaborationSection entityType="opportunity" entityId={opp.id} />
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

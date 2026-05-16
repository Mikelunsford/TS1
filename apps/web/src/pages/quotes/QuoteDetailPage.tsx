/**
 * QuoteDetailPage — header card + line item editor + workflow action buttons.
 *
 * Button visibility = (a) the parent quote is in a state where the action is
 * legal per `canTransition('quote', from, to)` from `lib/workflow.ts`, AND
 * (b) the caller holds the required capability via `useCapabilities`. Buttons
 * that do not change state (send / accept / duplicate) skip (a) but still
 * cap-gate.
 *
 * See workflow mapping at TS1/03-workspace/journal/2026-05-15-wave-4-backend-quote-project.md
 * and the BE handlers under supabase/functions/quotes-api/.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { QuoteActionDialog } from '@/components/quotes/QuoteActionDialog';
import { QuoteLineEditor } from '@/components/quotes/QuoteLineEditor';
import { QuoteStatusBadge } from '@/components/quotes/QuoteStatusBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { quoteKeys } from '@/lib/queryKeys/quotes';
import {
  acceptQuote,
  approveQuote,
  convertQuoteToProject,
  declineQuote,
  duplicateQuote,
  getQuote,
  requestRevisionsQuote,
  sendQuote,
  submitQuote,
} from '@/lib/services/quotesService';
import { canTransition, type QuoteState } from '@/lib/workflow';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).

type DialogKind = 'revise' | 'decline' | 'send' | 'accept' | 'convert' | null;

export default function QuoteDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { can } = useCapabilities();

  const quoteQuery = useQuery({
    queryKey: quoteKeys.detail(id),
    queryFn: () => getQuote(id),
    enabled: id.length > 0,
    staleTime: 10_000,
  });

  const quote = quoteQuery.data;
  const status: QuoteState | null = quote?.status ?? null;

  const [dialog, setDialog] = useState<DialogKind>(null);

  function invalidate() {
    void qc.invalidateQueries({ queryKey: quoteKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: quoteKeys.all });
  }

  const submitMutation = useMutation({
    mutationFn: () => submitQuote(id),
    onSuccess: () => {
      toast.success('Quote submitted');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Submit failed'),
  });

  const approveMutation = useMutation({
    mutationFn: () => approveQuote(id),
    onSuccess: () => {
      toast.success('Quote approved');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Approve failed'),
  });

  const reviseMutation = useMutation({
    mutationFn: (reason: string) => requestRevisionsQuote(id, { reason }),
    onSuccess: () => {
      toast.success('Revisions requested');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Request failed'),
  });

  const declineMutation = useMutation({
    mutationFn: (reason: string) => declineQuote(id, { reason }),
    onSuccess: () => {
      toast.success('Quote declined');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Decline failed'),
  });

  const sendMutation = useMutation({
    mutationFn: (vars: { to_email?: string; message?: string }) => sendQuote(id, vars),
    onSuccess: () => {
      toast.success('Quote sent');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Send failed'),
  });

  const acceptMutation = useMutation({
    mutationFn: (note?: string) => acceptQuote(id, note ? { note } : {}),
    onSuccess: () => {
      toast.success('Quote accepted');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Accept failed'),
  });

  const convertMutation = useMutation({
    mutationFn: (vars: { project_name: string; due_date: string | null }) =>
      convertQuoteToProject(id, {
        project_name: vars.project_name,
        due_date: vars.due_date,
      }),
    onSuccess: () => {
      toast.success('Project created from quote');
      setDialog(null);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Convert failed'),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateQuote(id),
    onSuccess: (data) => {
      toast.success(`Duplicated as ${data.quote_number}`);
      navigate(`/quotes/${data.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Duplicate failed'),
  });

  // Workflow button visibility — combines state-machine legality + cap.
  const showSubmit = status === 'draft' && can('quotes.write');
  const showApprove =
    status === 'submitted' &&
    can('quotes.approve') &&
    canTransition('quote', 'submitted', 'approved');
  const showRevise =
    status === 'submitted' &&
    can('quotes.write') &&
    canTransition('quote', 'submitted', 'revise_requested');
  const showDecline =
    (status === 'submitted' || status === 'approved') &&
    can('quotes.write') &&
    canTransition('quote', status, 'cancelled');
  // Send is a no-state-change action; surface from approved or submitted.
  const showSend = (status === 'approved' || status === 'submitted') && can('quotes.send');
  const showAccept = quote !== undefined && can('quotes.write');
  const showConvert =
    status === 'approved' &&
    can('quotes.convert') &&
    canTransition('quote', 'approved', 'project_pending');
  const showDuplicate = quote !== undefined && can('quotes.write');

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/quotes" className="hover:underline">
          Quotes
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{quote?.quote_number ?? '…'}</span>
      </nav>

      {quoteQuery.isLoading && <Skeleton className="h-32 w-full" />}
      {quoteQuery.error && <ErrorState title="Could not load quote" error={quoteQuery.error} />}

      {quote && (
        <>
          <section
            aria-labelledby="quote-header-heading"
            className="space-y-3 rounded-md border border-border bg-bg p-4"
          >
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1
                  id="quote-header-heading"
                  className="text-2xl font-semibold"
                  data-testid="quote-number"
                >
                  {quote.quote_number}
                </h1>
                <p className="text-sm text-fg-muted">
                  Created {formatDate(quote.created_at)}
                  {quote.valid_until ? ` · valid until ${formatDate(quote.valid_until)}` : ''}
                </p>
              </div>
              <QuoteStatusBadge status={quote.status} />
            </header>

            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Customer</dt>
                <dd className="text-fg">{quote.customer_name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Contact</dt>
                <dd className="text-fg">
                  {quote.contact_name ?? '—'}
                  {quote.contact_email && (
                    <span className="ml-2 text-fg-muted">{quote.contact_email}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Currency</dt>
                <dd className="font-mono text-fg">{quote.currency_code}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-fg-subtle">Service</dt>
                <dd className="text-fg">{quote.service_type}</dd>
              </div>
            </dl>

            <div className="grid gap-2 border-t border-border pt-3 text-sm sm:grid-cols-4">
              <Total label="Subtotal" cents={quote.subtotal_cents} currency={quote.currency_code} />
              <Total label="Discount" cents={quote.discount_cents} currency={quote.currency_code} />
              <Total label="Tax" cents={quote.tax_cents} currency={quote.currency_code} />
              <Total
                label="Total"
                cents={quote.total_cents}
                currency={quote.currency_code}
                emphasized
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              {showSubmit && (
                <WorkflowButton
                  data-testid="action-submit"
                  onClick={() => submitMutation.mutate()}
                  pending={submitMutation.isPending}
                >
                  Submit
                </WorkflowButton>
              )}
              {showApprove && (
                <WorkflowButton
                  data-testid="action-approve"
                  variant="primary"
                  onClick={() => approveMutation.mutate()}
                  pending={approveMutation.isPending}
                >
                  Approve
                </WorkflowButton>
              )}
              {showRevise && (
                <WorkflowButton
                  data-testid="action-revise"
                  onClick={() => setDialog('revise')}
                >
                  Request revisions
                </WorkflowButton>
              )}
              {showDecline && (
                <WorkflowButton
                  data-testid="action-decline"
                  variant="danger"
                  onClick={() => setDialog('decline')}
                >
                  Decline
                </WorkflowButton>
              )}
              {showSend && (
                <WorkflowButton
                  data-testid="action-send"
                  onClick={() => setDialog('send')}
                >
                  Send
                </WorkflowButton>
              )}
              {showAccept && (
                <WorkflowButton
                  data-testid="action-accept"
                  onClick={() => setDialog('accept')}
                >
                  Accept
                </WorkflowButton>
              )}
              {showConvert && (
                <WorkflowButton
                  data-testid="action-convert"
                  variant="primary"
                  onClick={() => setDialog('convert')}
                >
                  Convert to project
                </WorkflowButton>
              )}
              {showDuplicate && (
                <WorkflowButton
                  data-testid="action-duplicate"
                  onClick={() => duplicateMutation.mutate()}
                  pending={duplicateMutation.isPending}
                >
                  Duplicate
                </WorkflowButton>
              )}
            </div>
          </section>

          <QuoteLineEditor
            quoteId={quote.id}
            currency={quote.currency_code}
            editable={quote.status === 'draft' && can('quotes.write')}
          />
        </>
      )}

      <QuoteActionDialog
        open={dialog === 'revise'}
        title="Request revisions"
        description="Explain what needs to change. The reason is attached to the quote activity log."
        submitLabel="Send request"
        fields={[
          {
            key: 'reason',
            label: 'Reason',
            type: 'textarea',
            required: true,
            maxLength: 2000,
          },
        ]}
        onClose={() => setDialog(null)}
        onSubmit={async (vals) => reviseMutation.mutate(vals.reason ?? '')}
        pending={reviseMutation.isPending}
      />

      <QuoteActionDialog
        open={dialog === 'decline'}
        title="Decline quote"
        description="Cancels the quote. A reason is required for the activity log."
        submitLabel="Decline"
        fields={[
          {
            key: 'reason',
            label: 'Reason',
            type: 'textarea',
            required: true,
            maxLength: 2000,
          },
        ]}
        onClose={() => setDialog(null)}
        onSubmit={async (vals) => declineMutation.mutate(vals.reason ?? '')}
        pending={declineMutation.isPending}
      />

      <QuoteActionDialog
        open={dialog === 'send'}
        title="Send quote"
        description="Records a send event on the quote. Phase 19 wires real email."
        submitLabel="Send"
        fields={[
          {
            key: 'to_email',
            label: 'To email',
            type: 'email',
            initial: quote?.contact_email ?? '',
          },
          {
            key: 'message',
            label: 'Message',
            type: 'textarea',
            maxLength: 8000,
          },
        ]}
        onClose={() => setDialog(null)}
        onSubmit={async (vals) => {
          const body: { to_email?: string; message?: string } = {};
          if (vals.to_email?.trim()) body.to_email = vals.to_email;
          if (vals.message?.trim()) body.message = vals.message;
          sendMutation.mutate(body);
        }}
        pending={sendMutation.isPending}
      />

      <QuoteActionDialog
        open={dialog === 'accept'}
        title="Accept quote"
        description="Records customer acceptance on the activity log."
        submitLabel="Accept"
        fields={[
          {
            key: 'note',
            label: 'Note (optional)',
            type: 'textarea',
            maxLength: 2000,
          },
        ]}
        onClose={() => setDialog(null)}
        onSubmit={async (vals) =>
          acceptMutation.mutate(vals.note?.trim() ? vals.note : undefined)
        }
        pending={acceptMutation.isPending}
      />

      <QuoteActionDialog
        open={dialog === 'convert'}
        title="Convert to project"
        description="Creates a new project from this quote. The project name and an optional due date stamp the new row."
        submitLabel="Create project"
        fields={[
          {
            key: 'project_name',
            label: 'Project name',
            required: true,
            initial: quote ? `${quote.customer_name} — ${quote.quote_number}` : '',
            maxLength: 200,
          },
          {
            key: 'due_date',
            label: 'Due date (optional)',
            type: 'date',
          },
        ]}
        onClose={() => setDialog(null)}
        onSubmit={async (vals) =>
          convertMutation.mutate({
            project_name: vals.project_name ?? '',
            due_date: vals.due_date?.trim()
              ? new Date(vals.due_date).toISOString()
              : null,
          })
        }
        pending={convertMutation.isPending}
      />

      {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
      {quote && <CollaborationSection entityType="quote" entityId={quote.id} idPrefix="quote-collab" />}
      {/* End Phase 16 (Wave 10 Session 2). */}
    </div>
  );
}

function Total({
  label,
  cents,
  currency,
  emphasized,
}: {
  label: string;
  cents: number | string | bigint | null | undefined;
  currency: string;
  emphasized?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd
        className={
          emphasized ? 'text-lg font-semibold font-mono' : 'text-sm font-mono text-fg'
        }
      >
        <MoneyDisplay cents={cents} currency={currency} />
      </dd>
    </div>
  );
}

function WorkflowButton({
  children,
  onClick,
  pending,
  variant = 'default',
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
  pending?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  'data-testid'?: string;
}) {
  const base = 'rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50';
  const classes =
    variant === 'primary'
      ? 'bg-brand text-brand-fg hover:opacity-90'
      : variant === 'danger'
        ? 'border border-danger/40 bg-bg text-danger hover:bg-danger/5'
        : 'border border-border bg-bg text-fg hover:bg-bg-muted';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${base} ${classes}`}
      data-testid={rest['data-testid']}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

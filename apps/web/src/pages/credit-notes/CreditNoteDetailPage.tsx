/**
 * CreditNoteDetailPage — header card with credit note metadata and workflow
 * buttons (Issue, Apply, Void). Each button is gated by both:
 *   - `canTransition('credit_note', current, target)` from lib/workflow, AND
 *   - `can('credit_notes.write')` from useCapabilities.
 *
 * The Apply dialog asks for invoice_id + amount_cents. Amount is capped
 * client-side at (amount_cents - applied_cents); the server's CHECK
 * `applied_cents <= amount_cents` is the floor.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ApplyCreditDialog } from '@/components/credit-notes/ApplyCreditDialog';
import { CreditNoteStatusBadge } from '@/components/credit-notes/CreditNoteStatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { formatMoney } from '@/lib/money';
import { creditNoteKeys } from '@/lib/queryKeys/creditNotes';
import {
  applyCreditNote,
  getCreditNote,
  issueCreditNote,
  voidCreditNote,
} from '@/lib/services/creditNotesService';
import { canTransition, type CreditNoteState } from '@/lib/workflow';

export default function CreditNoteDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useCapabilities();

  const query = useQuery({
    queryKey: creditNoteKeys.detail(id),
    queryFn: () => getCreditNote(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const [applyOpen, setApplyOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: creditNoteKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: creditNoteKeys.all });
  }

  const issueMutation = useMutation({
    mutationFn: () => issueCreditNote(id, {}),
    onSuccess: () => {
      toast.success('Credit note issued');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Issue failed'),
  });

  const applyMutation = useMutation({
    mutationFn: (body: { invoice_id: string; amount_cents: number }) =>
      applyCreditNote(id, body),
    onSuccess: () => {
      toast.success('Credit applied');
      setApplyOpen(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Apply failed'),
  });

  const voidMutation = useMutation({
    mutationFn: (reason: string) => voidCreditNote(id, { reason }),
    onSuccess: () => {
      toast.success('Credit note voided');
      setVoidOpen(false);
      setVoidReason('');
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Void failed'),
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <ErrorState title="Could not load credit note" error={query.error} />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EmptyState title="Credit note not found" description="It may have been deleted." />
      </div>
    );
  }

  const cn = query.data;
  const status: CreditNoteState = cn.status;
  const writeCap = can('credit_notes.write');
  const amountCents = Number(cn.amount_cents);
  const appliedCents = Number(cn.applied_cents);
  const remaining = amountCents - appliedCents;

  const showIssue = writeCap && canTransition('credit_note', status, 'issued') && status !== 'issued';
  const showApply =
    writeCap && canTransition('credit_note', status, 'applied') && status !== 'applied' && remaining > 0;
  const showVoid = writeCap && canTransition('credit_note', status, 'voided') && status !== 'voided';

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/credit-notes" className="hover:underline">
          Credit notes
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{cn.credit_note_number}</span>
      </nav>

      <section
        aria-labelledby="cn-header-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <header className="flex flex-wrap items-center gap-3">
          <h1 id="cn-header-heading" className="text-2xl font-semibold">
            {cn.credit_note_number}
          </h1>
          <CreditNoteStatusBadge status={cn.status} />
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Customer</dt>
            <dd className="font-mono text-xs text-fg">
              <Link to={`/crm/customers/${cn.customer_id}`} className="text-brand hover:underline">
                {cn.customer_id.slice(0, 8)}…
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Related invoice</dt>
            <dd className="font-mono text-xs text-fg">
              {cn.invoice_id ? (
                <Link to={`/invoices/${cn.invoice_id}`} className="text-brand hover:underline">
                  {cn.invoice_id.slice(0, 8)}…
                </Link>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Issue date</dt>
            <dd className="text-fg">{formatDate(cn.issue_date)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Amount</dt>
            <dd className="font-mono text-fg">
              {formatMoney(cn.amount_cents, { currency: cn.currency_code })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Applied</dt>
            <dd className="font-mono text-fg">
              {formatMoney(cn.applied_cents, { currency: cn.currency_code })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Remaining</dt>
            <dd className="font-mono text-fg" data-testid="cn-remaining">
              {formatMoney(remaining, { currency: cn.currency_code })}
            </dd>
          </div>
          {cn.reason && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Reason</dt>
              <dd className="text-fg">{cn.reason}</dd>
            </div>
          )}
          {cn.notes && (
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Notes</dt>
              <dd className="text-fg">{cn.notes}</dd>
            </div>
          )}
          {cn.voided_at && (
            <div className="sm:col-span-3 rounded-md border border-danger/30 bg-danger/5 p-2">
              <dt className="text-xs uppercase tracking-wide text-danger">Voided</dt>
              <dd className="text-xs text-fg-muted">on {formatDate(cn.voided_at)}</dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {showIssue && (
            <button
              type="button"
              onClick={() => issueMutation.mutate()}
              disabled={issueMutation.isPending}
              className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
              data-testid="cn-issue"
            >
              {issueMutation.isPending ? 'Issuing…' : 'Issue'}
            </button>
          )}
          {showApply && (
            <button
              type="button"
              onClick={() => setApplyOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm font-medium text-fg hover:bg-bg-muted"
              data-testid="cn-apply"
            >
              Apply credit
            </button>
          )}
          {showVoid && (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm font-medium text-danger hover:bg-danger/5"
              data-testid="cn-void"
            >
              Void
            </button>
          )}
        </div>
      </section>

      <ApplyCreditDialog
        open={applyOpen}
        pending={applyMutation.isPending}
        currency={cn.currency_code}
        remainingCents={remaining}
        customerId={cn.customer_id}
        onCancel={() => setApplyOpen(false)}
        onConfirm={(body) => applyMutation.mutate(body)}
      />

      {voidOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cn-void-title"
          className="fixed inset-0 z-50 flex items-center justify-center"
        >
          <button
            type="button"
            aria-label="Close dialog"
            onClick={() => setVoidOpen(false)}
            className="absolute inset-0 bg-fg/40"
          />
          <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
            <h2 id="cn-void-title" className="text-lg font-semibold text-fg">
              Void credit note
            </h2>
            <p className="mt-1 text-sm text-fg-muted">
              Voids this credit note. A reason is required for the activity log.
            </p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                const r = voidReason.trim();
                if (r.length > 0) voidMutation.mutate(r);
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-medium text-fg">Reason</span>
                <textarea
                  required
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  maxLength={2000}
                  rows={4}
                  className="rounded border border-border bg-bg px-3 py-2 text-fg"
                  data-testid="cn-void-reason"
                />
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setVoidOpen(false)}
                  className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={voidMutation.isPending || voidReason.trim().length === 0}
                  className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50"
                  data-testid="cn-void-confirm"
                >
                  {voidMutation.isPending ? 'Voiding…' : 'Void'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

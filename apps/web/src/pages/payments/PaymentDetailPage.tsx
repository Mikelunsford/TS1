/**
 * PaymentDetailPage — header card with payment metadata, void button (gated
 * by `payments.void` + `voided_at IS NULL`), and a small edit form for
 * reference/description/external_ref + paid_at (gated by `voided_at IS NULL`
 * + `payments.write`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { SourceJETimeline } from '@/components/finance/SourceJETimeline';
import { PaymentAllocationDialog } from '@/components/payments/PaymentAllocationDialog';
import { VoidPaymentDialog } from '@/components/payments/VoidPaymentDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { formatMoney } from '@/lib/money';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { getPayment, updatePayment, voidPayment } from '@/lib/services/paymentsService';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import type { PaymentPatch } from '@/lib/types';

export default function PaymentDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useCapabilities();

  const query = useQuery({
    queryKey: paymentKeys.detail(id),
    queryFn: () => getPayment(id),
    enabled: id.length > 0,
    staleTime: 15_000,
  });

  const [voidOpen, setVoidOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [allocateOpen, setAllocateOpen] = useState(false);

  function invalidate(): void {
    void qc.invalidateQueries({ queryKey: paymentKeys.detail(id) });
    void qc.invalidateQueries({ queryKey: paymentKeys.all });
  }

  const voidMutation = useMutation({
    mutationFn: (void_reason: string) => voidPayment(id, { void_reason }),
    onSuccess: () => {
      toast.success('Payment voided');
      setVoidOpen(false);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to void payment'),
  });

  const editMutation = useMutation({
    mutationFn: (patch: PaymentPatch) => updatePayment(id, patch),
    onSuccess: () => {
      toast.success('Payment updated');
      setEditOpen(false);
      invalidate();
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Failed to update payment'),
  });

  if (query.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <ErrorState title="Could not load payment" error={query.error} />
      </div>
    );
  }
  if (!query.data) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <EmptyState title="Payment not found" description="It may have been deleted." />
      </div>
    );
  }

  const p = query.data;
  const isVoided = p.voided_at !== null;
  const canVoid = can('payments.void') && !isVoided;
  const canEdit = can('payments.write') && !isVoided;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/payments" className="hover:underline">
          Payments
        </Link>
        <span aria-hidden> / </span>
        <span className="text-fg">{p.payment_number}</span>
      </nav>

      <section
        aria-labelledby="payment-header-heading"
        className="space-y-3 rounded-md border border-border bg-bg p-4"
      >
        <header className="flex flex-wrap items-center gap-3">
          <h1 id="payment-header-heading" className="text-2xl font-semibold">
            {p.payment_number}
          </h1>
          {isVoided ? (
            <span className="inline-flex items-center rounded-md bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-danger/30">
              Voided
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md bg-success/10 px-2 py-0.5 text-xs font-medium text-success ring-1 ring-success/30">
              Posted
            </span>
          )}
        </header>

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Customer</dt>
            <dd className="font-mono text-xs text-fg">
              <Link to={`/crm/customers/${p.customer_id}`} className="text-brand hover:underline">
                {p.customer_id.slice(0, 8)}…
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Invoice</dt>
            <dd className="font-mono text-xs text-fg">
              <Link to={`/invoices/${p.invoice_id}`} className="text-brand hover:underline">
                {p.invoice_id.slice(0, 8)}…
              </Link>
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Amount</dt>
            <dd className="font-mono text-fg">
              {formatMoney(p.amount_cents, { currency: p.currency_code })}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Paid at</dt>
            <dd className="text-fg">{formatDate(p.paid_at)}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Method</dt>
            <dd className="font-mono text-xs text-fg">
              {p.payment_method_id ? p.payment_method_id.slice(0, 8) + '…' : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Reference</dt>
            <dd className="text-fg">{p.reference ?? '—'}</dd>
          </div>
          {p.description && (
            <div className="sm:col-span-3">
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">Description</dt>
              <dd className="text-fg">{p.description}</dd>
            </div>
          )}
          {p.external_ref && (
            <div>
              <dt className="text-xs uppercase tracking-wide text-fg-subtle">External ref</dt>
              <dd className="font-mono text-xs text-fg">{p.external_ref}</dd>
            </div>
          )}
          {isVoided && (
            <div className="sm:col-span-3 rounded-md border border-danger/30 bg-danger/5 p-2">
              <dt className="text-xs uppercase tracking-wide text-danger">Void reason</dt>
              <dd className="text-fg">{p.void_reason ?? '(none recorded)'}</dd>
              <dd className="text-xs text-fg-muted">
                Voided on {formatDate(p.voided_at)}
              </dd>
            </div>
          )}
        </dl>

        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              data-testid="payment-edit"
            >
              Edit
            </button>
          )}
          {canVoid && (
            <button
              type="button"
              onClick={() => setVoidOpen(true)}
              className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm font-medium text-danger hover:bg-danger/5"
              data-testid="payment-void"
            >
              Void payment
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => setAllocateOpen(true)}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
              data-testid="payment-allocate"
            >
              Allocate to invoices…
            </button>
          )}
        </div>
      </section>

      <SourceJETimeline sourceType="payment" sourceId={p.id} />

      <PaymentAllocationDialog
        payment={p}
        open={allocateOpen}
        onClose={() => setAllocateOpen(false)}
      />

      <VoidPaymentDialog
        open={voidOpen}
        pending={voidMutation.isPending}
        onCancel={() => setVoidOpen(false)}
        onConfirm={(reason) => voidMutation.mutate(reason)}
      />

      {editOpen && (
        <EditDialog
          initial={{
            paid_at: p.paid_at.slice(0, 10),
            reference: p.reference ?? '',
            description: p.description ?? '',
            external_ref: p.external_ref ?? '',
          }}
          pending={editMutation.isPending}
          onCancel={() => setEditOpen(false)}
          onConfirm={(patch) => editMutation.mutate(patch)}
        />
      )}
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="payment" entityId={id} idPrefix="payment-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}

interface EditInitial {
  paid_at: string;
  reference: string;
  description: string;
  external_ref: string;
}

function EditDialog({
  initial,
  pending,
  onCancel,
  onConfirm,
}: {
  initial: EditInitial;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (patch: PaymentPatch) => void;
}) {
  const [form, setForm] = useState<EditInitial>(initial);

  function submit(): void {
    const patch: PaymentPatch = {};
    if (form.paid_at !== initial.paid_at) {
      patch.paid_at = new Date(form.paid_at).toISOString();
    }
    if (form.reference !== initial.reference) {
      patch.reference = form.reference === '' ? null : form.reference;
    }
    if (form.description !== initial.description) {
      patch.description = form.description === '' ? null : form.description;
    }
    if (form.external_ref !== initial.external_ref) {
      patch.external_ref = form.external_ref === '' ? null : form.external_ref;
    }
    onConfirm(patch);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-edit-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
    >
      <h2 id="payment-edit-heading" className="text-lg font-semibold">
        Edit payment
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Paid at</span>
          <input
            type="date"
            value={form.paid_at}
            onChange={(e) => setForm({ ...form, paid_at: e.target.value })}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Reference</span>
          <input
            type="text"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            maxLength={120}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Description</span>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            maxLength={2000}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">External ref</span>
          <input
            type="text"
            value={form.external_ref}
            onChange={(e) => setForm({ ...form, external_ref: e.target.value })}
            maxLength={120}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
          data-testid="payment-edit-save"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

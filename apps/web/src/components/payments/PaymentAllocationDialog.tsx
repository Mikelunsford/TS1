/**
 * PaymentAllocationDialog — Wave 8 / Phase 12 / closes R-W5-PAY-01.
 *
 * Lets the user split a payment across multiple invoices. Shows the
 * currently allocated rows + remaining headroom + a small form to add
 * one or more new allocations.
 *
 * Headroom math mirrors the BE handler (`/payments/:id/allocate`):
 *
 *   if no allocations yet: remaining = 0 (legacy 1:1 holds the full amount)
 *   else:                  remaining = amount_cents - SUM(existing allocations)
 *
 * Per R-W8-OBS-02: the first allocate call against a legacy 1:1 payment
 * must specify the full breakdown (including the existing invoice), since
 * the recompute fn falls back to the 1:1 link until allocations exist.
 * To keep the UX simple this dialog refuses to open new allocations when
 * `existingAllocations.length === 0` AND directs the user to record a
 * fresh multi-allocation payment instead.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { InvoicePicker } from '@/components/payments/InvoicePicker';
import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { paymentKeys } from '@/lib/queryKeys/payments';
import { paymentAllocationKeys } from '@/lib/queryKeys/paymentAllocations';
import {
  allocatePayment,
  listPaymentAllocations,
} from '@/lib/services/paymentAllocationsService';
import type { Payment, PaymentAllocationInput } from '@/lib/types';

interface DraftAlloc {
  invoice_id: string;
  amount_cents: number;
}

export interface PaymentAllocationDialogProps {
  payment: Payment;
  open: boolean;
  onClose: () => void;
}

export function PaymentAllocationDialog({
  payment,
  open,
  onClose,
}: PaymentAllocationDialogProps) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<DraftAlloc[]>([
    { invoice_id: '', amount_cents: 0 },
  ]);

  const existingQuery = useQuery({
    queryKey: paymentAllocationKeys.byPayment(payment.id),
    queryFn: () => listPaymentAllocations(payment.id),
    enabled: open,
    staleTime: 10_000,
  });

  const existing = existingQuery.data ?? [];
  const paymentAmount = Number(payment.amount_cents);
  const existingSum = existing.reduce((s, r) => s + Number(r.amount_cents), 0);
  // Mirrors BE handler — legacy 1:1 fully holds the amount until any
  // allocation rows exist.
  const legacyHeld = existing.length === 0 ? paymentAmount : 0;
  const remaining = paymentAmount - existingSum - legacyHeld;

  const newSum = drafts.reduce((s, d) => s + (d.amount_cents || 0), 0);

  const allocateMutation = useMutation({
    mutationFn: (body: { allocations: PaymentAllocationInput[] }) =>
      allocatePayment(payment.id, body),
    onSuccess: () => {
      toast.success('Allocations recorded');
      void qc.invalidateQueries({ queryKey: paymentAllocationKeys.byPayment(payment.id) });
      void qc.invalidateQueries({ queryKey: paymentKeys.detail(payment.id) });
      void qc.invalidateQueries({ queryKey: paymentKeys.all });
      onClose();
      setDrafts([{ invoice_id: '', amount_cents: 0 }]);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : 'Allocation failed'),
  });

  if (!open) return null;

  function patchDraft(idx: number, patch: Partial<DraftAlloc>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function addDraft() {
    setDrafts((prev) => [...prev, { invoice_id: '', amount_cents: 0 }]);
  }

  function removeDraft(idx: number) {
    setDrafts((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function canSubmit(): boolean {
    if (drafts.length === 0) return false;
    if (drafts.some((d) => d.invoice_id === '' || d.amount_cents <= 0)) return false;
    if (newSum > remaining) return false;
    if (remaining <= 0) return false;
    return true;
  }

  function submit() {
    const allocations: PaymentAllocationInput[] = drafts.map((d) => ({
      invoice_id: d.invoice_id,
      amount_cents: d.amount_cents,
    }));
    allocateMutation.mutate({ allocations });
  }

  const noHeadroom = remaining <= 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="payment-allocation-heading"
      className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
      data-testid="payment-allocation-dialog"
    >
      <div className="w-full max-w-2xl space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
        <header>
          <h2 id="payment-allocation-heading" className="text-lg font-semibold">
            Allocate payment to invoices
          </h2>
          <p className="text-sm text-fg-muted">
            Split <span className="font-mono text-fg">{payment.payment_number}</span> across
            invoices for the same customer + currency.
          </p>
        </header>

        <section
          aria-label="Allocation summary"
          className="grid gap-3 rounded-md border border-border bg-bg-muted p-3 text-sm sm:grid-cols-4"
        >
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Payment total</dt>
            <dd className="font-mono text-fg" data-testid="alloc-payment-total">
              <MoneyDisplay cents={paymentAmount} currency={payment.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Already allocated</dt>
            <dd className="font-mono text-fg" data-testid="alloc-existing-sum">
              <MoneyDisplay cents={existingSum} currency={payment.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Legacy 1:1 held</dt>
            <dd className="font-mono text-fg" data-testid="alloc-legacy-held">
              <MoneyDisplay cents={legacyHeld} currency={payment.currency_code} />
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-fg-subtle">Remaining</dt>
            <dd
              className={`font-mono ${noHeadroom ? 'text-danger' : 'text-success'}`}
              data-testid="alloc-remaining"
            >
              <MoneyDisplay cents={remaining} currency={payment.currency_code} />
            </dd>
          </div>
        </section>

        {existing.length > 0 && (
          <section aria-label="Existing allocations" className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">
              Existing allocations
            </h3>
            <ul className="divide-y divide-border rounded-md border border-border">
              {existing.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  data-testid={`alloc-existing-${a.id}`}
                >
                  <span className="font-mono text-xs text-fg">{a.invoice_id.slice(0, 8)}…</span>
                  <span className="font-mono text-fg">
                    <MoneyDisplay cents={a.amount_cents} currency={payment.currency_code} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {noHeadroom && existing.length === 0 && (
          <p
            className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning"
            data-testid="alloc-legacy-warning"
          >
            This payment is still tracked as a legacy 1:1 invoice link. To split it, void
            the payment and record a new multi-allocation payment instead.
          </p>
        )}

        {!noHeadroom && (
          <section aria-label="New allocations" className="space-y-2">
            <h3 className="text-xs uppercase tracking-wide text-fg-subtle">New allocations</h3>
            <div className="space-y-2">
              {drafts.map((draft, idx) => (
                <div
                  key={idx}
                  className="grid gap-2 rounded-md border border-border bg-bg p-2 sm:grid-cols-[1fr_8rem_2.5rem]"
                  data-testid={`alloc-draft-${idx}`}
                >
                  <InvoicePicker
                    value={draft.invoice_id}
                    customerId={payment.customer_id}
                    onSelect={(inv) =>
                      patchDraft(idx, { invoice_id: inv ? inv.id : '' })
                    }
                    data-testid={`alloc-draft-${idx}-invoice`}
                  />
                  <MoneyInput
                    value={draft.amount_cents}
                    onChange={(c) => patchDraft(idx, { amount_cents: c })}
                    currency={payment.currency_code}
                    aria-label={`Allocation ${idx + 1} amount`}
                  />
                  <button
                    type="button"
                    onClick={() => removeDraft(idx)}
                    disabled={drafts.length <= 1}
                    aria-label="Remove allocation"
                    className="rounded-md border border-border bg-bg px-2 text-sm text-fg-muted hover:bg-bg-muted disabled:opacity-30"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={addDraft}
                className="rounded-md border border-border bg-bg px-2 py-1 text-xs text-fg hover:bg-bg-muted"
                data-testid="alloc-add-draft"
              >
                + Add allocation
              </button>
              <span
                className={`text-xs ${newSum > remaining ? 'text-danger' : 'text-fg-muted'}`}
                data-testid="alloc-new-sum"
              >
                New sum:{' '}
                <span className="font-mono">
                  <MoneyDisplay cents={newSum} currency={payment.currency_code} />
                </span>{' '}
                of{' '}
                <span className="font-mono">
                  <MoneyDisplay cents={remaining} currency={payment.currency_code} />
                </span>
              </span>
            </div>
          </section>
        )}

        <footer className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit() || allocateMutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="alloc-submit"
          >
            {allocateMutation.isPending ? 'Allocating…' : 'Allocate'}
          </button>
        </footer>
      </div>
    </div>
  );
}

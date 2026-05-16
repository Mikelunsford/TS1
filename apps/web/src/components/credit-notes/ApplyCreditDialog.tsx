/**
 * ApplyCreditDialog — pick an invoice + amount_cents to apply a credit
 * note toward. Used by CreditNoteDetailPage's Apply action.
 *
 * Client-side validation:
 *   - invoice_id required (UUID)
 *   - amount_cents > 0 and <= remaining (= amount - applied)
 *   - server enforces currency parity (rejected by trigger if mismatch)
 *
 * Server endpoint: POST /invoicing-api/credit-notes/:id/apply
 */
import { useEffect, useMemo, useState } from 'react';

import { InvoicePicker } from '@/components/payments/InvoicePicker';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { formatMoney } from '@/lib/money';
import type { CreditNoteApply, Invoice } from '@/lib/types';

export interface ApplyCreditDialogProps {
  open: boolean;
  pending?: boolean;
  /** Credit note's currency_code — used to format the MoneyInput. */
  currency: string;
  /** Remaining = amount_cents - applied_cents. Cap for amount_cents input. */
  remainingCents: number;
  /** Optional pre-scope to credit note's customer. */
  customerId?: string;
  onCancel: () => void;
  onConfirm: (body: CreditNoteApply) => void;
}

export function ApplyCreditDialog({
  open,
  pending,
  currency,
  remainingCents,
  customerId,
  onCancel,
  onConfirm,
}: ApplyCreditDialogProps) {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [amount, setAmount] = useState<number>(0);

  useEffect(() => {
    if (open) {
      setInvoice(null);
      setAmount(remainingCents > 0 ? remainingCents : 0);
    }
  }, [open, remainingCents]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const errors = useMemo(() => {
    const e: { invoice?: string; amount?: string } = {};
    if (!invoice) e.invoice = 'Pick an invoice.';
    if (amount <= 0) e.amount = 'Amount must be greater than zero.';
    if (amount > remainingCents) {
      e.amount = `Amount exceeds remaining credit (${formatMoney(remainingCents, { currency })}).`;
    }
    return e;
  }, [invoice, amount, remainingCents, currency]);

  const valid = Object.keys(errors).length === 0;

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-credit-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 bg-fg/40"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
        <h2 id="apply-credit-title" className="text-lg font-semibold text-fg">
          Apply credit
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Apply this credit toward an open invoice. Remaining{' '}
          <span className="font-mono">
            {formatMoney(remainingCents, { currency })}
          </span>
          .
        </p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid || !invoice) return;
            onConfirm({ invoice_id: invoice.id, amount_cents: amount });
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">
              Invoice <span className="text-danger" aria-hidden>*</span>
            </span>
            <InvoicePicker
              value={invoice?.id ?? ''}
              onSelect={setInvoice}
              {...(customerId ? { customerId } : {})}
              data-testid="apply-invoice-picker"
            />
            {errors.invoice && (
              <span className="text-xs text-danger">{errors.invoice}</span>
            )}
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">
              Amount <span className="text-danger" aria-hidden>*</span>
            </span>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              currency={currency}
              aria-label="Apply amount"
            />
            {errors.amount && (
              <span className="text-xs text-danger" data-testid="apply-amount-error">
                {errors.amount}
              </span>
            )}
          </label>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded border border-border px-3 py-1.5 text-sm text-fg hover:bg-bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending || !valid}
              className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50"
              data-testid="apply-confirm"
            >
              {pending ? 'Applying…' : 'Apply credit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

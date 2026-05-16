/**
 * VoidPaymentDialog — confirm-and-reason dialog for POST /payments/:id/void.
 *
 * Mirrors the simple modal pattern used by QuoteActionDialog. The reason is
 * required (server enforces min:1, max:2000 via PaymentVoidSchema). The
 * recompute trigger handles the invoice rollup automatically.
 */
import { useEffect, useState } from 'react';

export interface VoidPaymentDialogProps {
  open: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: (void_reason: string) => void;
}

export function VoidPaymentDialog({
  open,
  pending,
  onCancel,
  onConfirm,
}: VoidPaymentDialogProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const trimmed = reason.trim();
  const valid = trimmed.length > 0 && trimmed.length <= 2000;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-payment-title"
      className="fixed inset-0 z-50 flex items-center justify-center"
    >
      <button
        type="button"
        aria-label="Close dialog"
        onClick={onCancel}
        className="absolute inset-0 bg-fg/40"
      />
      <div className="relative w-full max-w-md rounded-lg border border-border bg-bg p-6 shadow-lg">
        <h2 id="void-payment-title" className="text-lg font-semibold text-fg">
          Void payment
        </h2>
        <p className="mt-1 text-sm text-fg-muted">
          Voids this payment and rolls the amount back to the invoice balance. The
          reason is recorded with the payment for audit.
        </p>
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConfirm(trimmed);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-fg">
              Reason <span className="text-danger" aria-hidden>*</span>
            </span>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={2000}
              rows={4}
              className="rounded border border-border bg-bg px-3 py-2 text-fg"
              data-testid="void-reason"
            />
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
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-brand-fg disabled:opacity-50"
              data-testid="void-confirm"
            >
              {pending ? 'Voiding…' : 'Void payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

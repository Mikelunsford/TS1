/**
 * VendorBillPayDialog — collects a payment amount (defaults to remaining
 * balance) and POSTs to `/vendor-bills/:id/pay`. BE auto-transitions the
 * row to either `partially_paid` or `paid` based on running total.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/ui/MoneyInput';
import { vendorBillKeys } from '@/lib/queryKeys/vendorBills';
import { payVendorBill } from '@/lib/services/vendorBillsService';
import type { VendorBill } from '@/lib/types';

interface Props {
  open: boolean;
  bill: VendorBill;
  onClose: () => void;
}

export function VendorBillPayDialog({ open, bill, onClose }: Props) {
  const qc = useQueryClient();
  const balance = Number(bill.balance_cents ?? bill.total_cents) - Number(bill.paid_cents);
  const remaining = Math.max(0, balance);
  const [amount, setAmount] = useState<number>(remaining);

  const mutation = useMutation({
    mutationFn: () => {
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Amount must be positive');
      }
      // Omit the field entirely to mean "pay full remaining balance".
      if (amount === remaining) {
        return payVendorBill(bill.id, {});
      }
      return payVendorBill(bill.id, { amount_cents: amount });
    },
    onSuccess: () => {
      toast.success('Payment recorded');
      void qc.invalidateQueries({ queryKey: vendorBillKeys.detail(bill.id) });
      void qc.invalidateQueries({ queryKey: vendorBillKeys.all });
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Payment failed'),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="vb-pay-heading"
      className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
      data-testid="vb-pay-dialog"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
        <header className="flex items-center justify-between">
          <h2 id="vb-pay-heading" className="text-lg font-semibold">
            Pay vendor bill
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg-muted"
          >
            Close
          </button>
        </header>

        <div className="space-y-2 text-sm">
          <p className="text-fg-muted">
            Bill <span className="font-mono">{bill.bill_number}</span>. Remaining balance:{' '}
            <span className="font-mono text-fg">{remaining}</span> cents.
          </p>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">Amount</span>
            <MoneyInput
              value={amount}
              onChange={setAmount}
              currency={bill.currency_code}
              aria-label="Payment amount"
            />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="vb-pay-submit"
          >
            {mutation.isPending ? 'Paying…' : 'Record payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

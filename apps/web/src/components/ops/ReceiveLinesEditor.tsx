/**
 * ReceiveLinesEditor — captures the new cumulative `received_qty` for a
 * receiving order. The BE handler takes the ABSOLUTE cumulative value
 * (not a delta) — if it stays < expected_qty the RO transitions to
 * `partial`; if it reaches expected_qty it stamps `received_at` and
 * transitions to `received`.
 *
 * Wave 8f / Phase 13.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { receivingOrderKeys } from '@/lib/queryKeys/receivingOrders';
import { receiveReceivingOrder } from '@/lib/services/receivingOrdersService';
import type { ReceivingOrder } from '@/lib/types';

interface Props {
  open: boolean;
  ro: ReceivingOrder;
  onClose: () => void;
}

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number.parseFloat(v);
}

export function ReceiveLinesEditor({ open, ro, onClose }: Props) {
  const qc = useQueryClient();
  const expected = num(ro.expected_qty);
  const alreadyReceived = num(ro.received_qty);
  const outstanding = Math.max(0, expected - alreadyReceived);

  // Suggest cumulative = alreadyReceived + outstanding (i.e. fully receive).
  const [cumulative, setCumulative] = useState<string>(
    String(alreadyReceived + outstanding),
  );
  const [notes, setNotes] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const v = Number(cumulative);
      if (!Number.isFinite(v) || v < 0) {
        throw new Error('Cumulative received qty must be a non-negative number');
      }
      if (v < alreadyReceived) {
        throw new Error('Cumulative received cannot decrease below the prior receipt');
      }
      return receiveReceivingOrder(ro.id, {
        received_qty: v,
        ...(notes.trim() ? { notes } : {}),
      });
    },
    onSuccess: () => {
      toast.success('Receipt recorded');
      void qc.invalidateQueries({ queryKey: receivingOrderKeys.detail(ro.id) });
      void qc.invalidateQueries({ queryKey: receivingOrderKeys.all });
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Receive failed'),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="ro-receive-heading"
      className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
      data-testid="ro-receive-dialog"
    >
      <div className="w-full max-w-md space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
        <header className="flex items-center justify-between">
          <h2 id="ro-receive-heading" className="text-lg font-semibold">
            Receive — {ro.ro_number}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg-muted"
          >
            Close
          </button>
        </header>

        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-muted">Expected</dt>
          <dd className="text-right font-mono">{expected}</dd>
          <dt className="text-fg-muted">Already received</dt>
          <dd className="text-right font-mono">{alreadyReceived}</dd>
          <dt className="text-fg-muted">Outstanding</dt>
          <dd className="text-right font-mono">{outstanding}</dd>
        </dl>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">
            New cumulative received qty
          </span>
          <input
            type="number"
            min={alreadyReceived}
            step="any"
            value={cumulative}
            onChange={(e) => setCumulative(e.target.value)}
            className="w-32 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            data-testid="ro-receive-qty"
          />
          <span className="text-xs text-fg-subtle">
            Enter the new total (absolute, not a delta).
          </span>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs uppercase tracking-wide text-fg-subtle">Notes (optional)</span>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </label>

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
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-brand-fg hover:opacity-90 disabled:opacity-50"
            data-testid="ro-receive-submit"
          >
            {mutation.isPending ? 'Saving…' : 'Record receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

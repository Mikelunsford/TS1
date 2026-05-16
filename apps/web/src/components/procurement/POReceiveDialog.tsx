/**
 * POReceiveDialog — partial-receive form. Per-line `quantity_received`
 * input, defaulting to outstanding (ordered − received). Submitting POSTs
 * to `/purchase-orders/:id/receive`; BE transitions the PO to either
 * `partial_received` or `received` based on whether every line is fully
 * received.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';

import { MoneyDisplay } from '@/components/inventory/MoneyDisplay';
import { purchaseOrderKeys } from '@/lib/queryKeys/purchaseOrders';
import { receivePurchaseOrder } from '@/lib/services/purchaseOrdersService';
import type { POLineItem } from '@/lib/types';

interface Props {
  open: boolean;
  poId: string;
  currency: string;
  lines: POLineItem[];
  onClose: () => void;
}

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number(v);
}

export function POReceiveDialog({ open, poId, currency, lines, onClose }: Props) {
  const qc = useQueryClient();
  const [received, setReceived] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.map((l) => [l.id, String(Math.max(0, num(l.quantity) - num(l.quantity_received)))]),
    ),
  );

  const mutation = useMutation({
    mutationFn: () => {
      const payload = lines
        .map((l) => ({ po_line_item_id: l.id, quantity_received: Number(received[l.id] ?? 0) }))
        .filter((row) => Number.isFinite(row.quantity_received) && row.quantity_received > 0);
      if (payload.length === 0) {
        throw new Error('Enter a positive quantity on at least one line');
      }
      return receivePurchaseOrder(poId, { lines: payload });
    },
    onSuccess: () => {
      toast.success('PO receipt recorded');
      void qc.invalidateQueries({ queryKey: purchaseOrderKeys.detail(poId) });
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Receive failed'),
  });

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      aria-labelledby="po-receive-heading"
      className="fixed inset-0 z-30 flex items-center justify-center bg-fg/40 px-4"
      data-testid="po-receive-dialog"
    >
      <div className="w-full max-w-2xl space-y-4 rounded-md border border-border bg-bg p-5 shadow-lg">
        <header className="flex items-center justify-between">
          <h2 id="po-receive-heading" className="text-lg font-semibold">
            Receive items
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-bg-muted"
          >
            Close
          </button>
        </header>

        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
              <tr>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Ordered</th>
                <th className="px-3 py-2 text-right">Received</th>
                <th className="px-3 py-2 text-right">This receipt</th>
                <th className="px-3 py-2 text-right">Unit cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l) => (
                <tr key={l.id}>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-right font-mono">{num(l.quantity)}</td>
                  <td className="px-3 py-2 text-right font-mono text-fg-muted">
                    {num(l.quantity_received)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step="0.0001"
                      value={received[l.id] ?? ''}
                      onChange={(e) =>
                        setReceived({ ...received, [l.id]: e.target.value })
                      }
                      className="w-24 rounded-md border border-border bg-bg px-2 py-1 text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                      data-testid={`receive-qty-${l.id}`}
                    />
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    <MoneyDisplay cents={l.unit_cost_cents} currency={currency} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
            data-testid="po-receive-submit"
          >
            {mutation.isPending ? 'Receiving…' : 'Record receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

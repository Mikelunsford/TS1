/**
 * PurchaseOrderDetailPage — vendor's PO detail with Acknowledge button
 * (Phase 22).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router-dom';

import { vendorPortalKeys } from '@/lib/queryKeys/vendorPortal';
import {
  acknowledgePortalPurchaseOrder,
  getPortalPurchaseOrder,
} from '@/lib/services/vendorPortalService';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/money';

export default function PurchaseOrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [acked, setAcked] = useState<string | null>(null);

  const q = useQuery({
    queryKey: vendorPortalKeys.poDetail(id),
    queryFn: () => getPortalPurchaseOrder(id),
    enabled: id.length > 0,
  });

  const ackMutation = useMutation({
    mutationFn: () => acknowledgePortalPurchaseOrder(id),
    onSuccess: (data) => {
      setAcked(data.acknowledged_at);
      void qc.invalidateQueries({ queryKey: vendorPortalKeys.poDetail(id) });
    },
  });

  if (q.isLoading) return <p className="p-6 text-fg-muted">Loading…</p>;
  if (q.isError || !q.data) return <p className="p-6 text-red-600">Failed to load PO.</p>;

  const po = q.data;
  const currency = (po.currency_code as string | undefined) ?? 'USD';

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{po.po_number}</h1>
          <p className="text-sm text-fg-muted">
            Issued {formatDate(po.issue_date)} · Status {po.status}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={() => ackMutation.mutate()}
            disabled={ackMutation.isPending || ackMutation.isSuccess}
            className="rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {ackMutation.isPending
              ? 'Acknowledging…'
              : ackMutation.isSuccess
                ? 'Acknowledged'
                : 'Acknowledge'}
          </button>
          {acked && (
            <p className="text-xs text-fg-muted">
              You acknowledged at {formatDate(acked)}.
            </p>
          )}
          {ackMutation.isError && (
            <p className="text-xs text-red-600">Acknowledge failed.</p>
          )}
        </div>
      </header>

      <section className="rounded-md border border-border bg-bg p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Summary
        </h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-fg-muted">Subtotal</dt>
          <dd>{formatMoney(po.subtotal_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted">Tax</dt>
          <dd>{formatMoney(po.tax_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted">Shipping</dt>
          <dd>{formatMoney(po.shipping_cents ?? 0, { currency })}</dd>
          <dt className="text-fg-muted font-semibold">Total</dt>
          <dd className="font-semibold">
            {formatMoney(po.total_cents ?? 0, { currency })}
          </dd>
        </dl>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-fg-muted">
          Line items
        </h2>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-fg-muted">
              <th className="px-3 py-2">Description</th>
              <th className="px-3 py-2 text-right">Qty</th>
              <th className="px-3 py-2 text-right">Unit cost</th>
              <th className="px-3 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {po.lines.map((line) => (
              <tr key={String(line.id ?? line.position)} className="border-b border-border">
                <td className="px-3 py-2">{line.description}</td>
                <td className="px-3 py-2 text-right">{String(line.quantity ?? '—')}</td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(line.unit_cost_cents ?? 0, { currency })}
                </td>
                <td className="px-3 py-2 text-right">
                  {formatMoney(line.line_total_cents ?? 0, { currency })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

/**
 * ShipmentDetailPage — header + workflow buttons (start loading / ship /
 * cancel). Wave 8f / Phase 13. Cancel accepts an optional reason.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ShipmentStatusBadge } from '@/components/ops/ShipmentStatusBadge';
import { ShipmentWorkflowButtons } from '@/components/ops/ShipmentWorkflowButtons';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { shipmentKeys } from '@/lib/queryKeys/shipments';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  cancelShipment,
  getShipment,
  shipShipment,
  startLoadingShipment,
} from '@/lib/services/shipmentsService';

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [cancelReason, setCancelReason] = useState('');
  const [showCancelPrompt, setShowCancelPrompt] = useState(false);

  const query = useQuery({
    queryKey: shipmentKeys.detail(id ?? ''),
    queryFn: () => getShipment(id!),
    enabled: Boolean(id),
  });

  const startLoadingMutation = useMutation({
    mutationFn: () => startLoadingShipment(id!),
    onSuccess: () => {
      toast.success('Loading started');
      void qc.invalidateQueries({ queryKey: shipmentKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Start loading failed'),
  });

  const shipMutation = useMutation({
    mutationFn: () => shipShipment(id!),
    onSuccess: () => {
      toast.success('Marked shipped');
      void qc.invalidateQueries({ queryKey: shipmentKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Ship failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () =>
      cancelShipment(id!, cancelReason.trim() ? { cancellation_reason: cancelReason } : undefined),
    onSuccess: () => {
      toast.success('Shipment cancelled');
      setShowCancelPrompt(false);
      setCancelReason('');
      void qc.invalidateQueries({ queryKey: shipmentKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });

  if (!id) return null;
  if (query.isLoading) return <Skeleton className="m-6 h-64" />;
  if (query.error) return <ErrorState title="Could not load shipment" error={query.error} />;
  if (!query.data) return null;

  const s = query.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/shipments" className="hover:underline">Shipments</Link>
        <span aria-hidden> / </span>
        <span className="text-fg font-mono text-xs">{s.shipment_number}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{s.shipment_number}</h1>
          <ShipmentStatusBadge status={s.status} />
        </div>
        <ShipmentWorkflowButtons
          status={s.status}
          onStartLoading={() => startLoadingMutation.mutate()}
          onShip={() => shipMutation.mutate()}
          onCancel={() => setShowCancelPrompt(true)}
          pending={{
            startLoading: startLoadingMutation.isPending,
            ship: shipMutation.isPending,
            cancel: cancelMutation.isPending,
          }}
        />
      </header>

      {showCancelPrompt && (
        <div
          className="rounded-md border border-danger/30 bg-danger/5 p-3 text-sm"
          data-testid="shipment-cancel-prompt"
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-fg-subtle">
              Cancellation reason (optional)
            </span>
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              className="rounded-md border border-border bg-bg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setShowCancelPrompt(false);
                setCancelReason('');
              }}
              className="rounded-md border border-border bg-bg px-3 py-1 text-sm text-fg hover:bg-bg-muted"
            >
              Keep
            </button>
            <button
              type="button"
              onClick={() => cancelMutation.mutate()}
              disabled={cancelMutation.isPending}
              className="rounded-md border border-danger/40 bg-bg px-3 py-1 text-sm text-danger hover:bg-danger/5 disabled:opacity-50"
            >
              {cancelMutation.isPending ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          </div>
        </div>
      )}

      <section className="rounded-md border border-border bg-bg p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">Project</dt>
          <dd className="font-mono text-xs">{s.project_id.slice(0, 8)}…</dd>
          <dt className="text-fg-muted">Qty shipped</dt>
          <dd className="text-right font-mono">{String(s.qty_shipped)}</dd>
          <dt className="text-fg-muted">Carrier</dt>
          <dd>{s.carrier_name}</dd>
          <dt className="text-fg-muted">Tracking</dt>
          <dd className="font-mono text-xs">{s.tracking_number ?? '—'}</dd>
          <dt className="text-fg-muted">Scheduled pickup</dt>
          <dd>{s.scheduled_pickup_at ? formatDate(s.scheduled_pickup_at) : '—'}</dd>
          <dt className="text-fg-muted">Loading started</dt>
          <dd>{s.loading_started_at ? formatDate(s.loading_started_at) : '—'}</dd>
          <dt className="text-fg-muted">Shipped at</dt>
          <dd>{s.shipped_at ? formatDate(s.shipped_at) : '—'}</dd>
          <dt className="text-fg-muted">Cancelled at</dt>
          <dd>{s.cancelled_at ? formatDate(s.cancelled_at) : '—'}</dd>
          {s.cancellation_reason && (
            <>
              <dt className="text-fg-muted">Cancellation reason</dt>
              <dd className="whitespace-pre-wrap">{s.cancellation_reason}</dd>
            </>
          )}
        </dl>
        {s.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-md bg-bg-muted p-2 text-sm">{s.notes}</p>
        )}
      </section>
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="shipment" entityId={id} idPrefix="shipment-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}

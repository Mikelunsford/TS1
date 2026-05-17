/**
 * ReceivingOrderDetailPage — header + workflow buttons + inline line-receive
 * dialog. Wave 8f / Phase 13.
 *
 * `receive` body uses absolute cumulative `received_qty` (NOT a delta) —
 * the BE picks `partial` (qty < expected) vs `received` (qty >= expected).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ReceivingOrderStatusBadge } from '@/components/ops/ReceivingOrderStatusBadge';
import { ReceivingWorkflowButtons } from '@/components/ops/ReceivingWorkflowButtons';
import { ReceiveLinesEditor } from '@/components/ops/ReceiveLinesEditor';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { receivingOrderKeys } from '@/lib/queryKeys/receivingOrders';
// Phase 16 (Wave 10 Session 2) — B1 owns this block.
import { CollaborationSection } from '@/components/collaboration/CollaborationSection';
// End Phase 16 (Wave 10 Session 2).
import {
  cancelReceivingOrder,
  getReceivingOrder,
} from '@/lib/services/receivingOrdersService';

export default function ReceivingOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: receivingOrderKeys.detail(id ?? ''),
    queryFn: () => getReceivingOrder(id!, { expand: ['project'] }),
    enabled: Boolean(id),
  });

  const [receiveOpen, setReceiveOpen] = useState(false);

  const cancelMutation = useMutation({
    mutationFn: () => cancelReceivingOrder(id!),
    onSuccess: () => {
      toast.success('Receiving order cancelled');
      void qc.invalidateQueries({ queryKey: receivingOrderKeys.detail(id!) });
      void qc.invalidateQueries({ queryKey: receivingOrderKeys.all });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });

  if (!id) return null;
  if (query.isLoading) return <Skeleton className="m-6 h-64" />;
  if (query.error) return <ErrorState title="Could not load receiving order" error={query.error} />;
  if (!query.data) return null;

  const ro = query.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/receiving" className="hover:underline">Receiving orders</Link>
        <span aria-hidden> / </span>
        <span className="text-fg font-mono text-xs">{ro.ro_number}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{ro.ro_number}</h1>
          <div className="flex items-center gap-2">
            <ReceivingOrderStatusBadge status={ro.status} />
            <span className="text-xs text-fg-muted">{ro.source}</span>
          </div>
        </div>
        <ReceivingWorkflowButtons
          status={ro.status}
          onReceive={() => setReceiveOpen(true)}
          onCancel={() => cancelMutation.mutate()}
          pending={{ cancel: cancelMutation.isPending }}
        />
      </header>

      <section className="rounded-md border border-border bg-bg p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">Project</dt>
          <dd>
            {ro.project ? (
              <span>
                <span className="font-mono text-xs text-fg-muted">{ro.project.project_number}</span>
                <span className="ml-2">{ro.project.name}</span>
              </span>
            ) : (
              <span className="font-mono text-xs text-fg-muted">{ro.project_id.slice(0, 8)}…</span>
            )}
          </dd>
          <dt className="text-fg-muted">Expected qty</dt>
          <dd className="text-right font-mono">{String(ro.expected_qty)}</dd>
          <dt className="text-fg-muted">Received qty</dt>
          <dd className="text-right font-mono">{String(ro.received_qty)}</dd>
          <dt className="text-fg-muted">Vendor</dt>
          <dd>{ro.vendor ?? '—'}</dd>
          <dt className="text-fg-muted">Expected at</dt>
          <dd>{ro.expected_at ? formatDate(ro.expected_at) : '—'}</dd>
          <dt className="text-fg-muted">Received at</dt>
          <dd>{ro.received_at ? formatDate(ro.received_at) : '—'}</dd>
          <dt className="text-fg-muted">Cancelled at</dt>
          <dd>{ro.cancelled_at ? formatDate(ro.cancelled_at) : '—'}</dd>
        </dl>
        {ro.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-md bg-bg-muted p-2 text-sm">{ro.notes}</p>
        )}
      </section>

      <ReceiveLinesEditor open={receiveOpen} ro={ro} onClose={() => setReceiveOpen(false)} />
    {/* Phase 16 (Wave 10 Session 2) — B1 owns this block. */}
    {id && <CollaborationSection entityType="receiving_order" entityId={id} idPrefix="receiving-collab" />}
    {/* End Phase 16 (Wave 10 Session 2). */}

    </div>
  );
}

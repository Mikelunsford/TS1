/**
 * ProductionRunDetailPage — header + workflow buttons (start/complete/cancel).
 * Wave 8f / Phase 13.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';

import { ProductionRunStatusBadge } from '@/components/ops/ProductionRunStatusBadge';
import { ProductionWorkflowButtons } from '@/components/ops/ProductionWorkflowButtons';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { productionRunKeys } from '@/lib/queryKeys/productionRuns';
import {
  cancelProductionRun,
  completeProductionRun,
  getProductionRun,
  startProductionRun,
} from '@/lib/services/productionRunsService';

export default function ProductionRunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: productionRunKeys.detail(id ?? ''),
    queryFn: () => getProductionRun(id!),
    enabled: Boolean(id),
  });

  const startMutation = useMutation({
    mutationFn: () => startProductionRun(id!),
    onSuccess: () => {
      toast.success('Run started');
      void qc.invalidateQueries({ queryKey: productionRunKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Start failed'),
  });

  const completeMutation = useMutation({
    mutationFn: () => completeProductionRun(id!),
    onSuccess: () => {
      toast.success('Run completed');
      void qc.invalidateQueries({ queryKey: productionRunKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Complete failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: () => cancelProductionRun(id!),
    onSuccess: () => {
      toast.success('Run cancelled');
      void qc.invalidateQueries({ queryKey: productionRunKeys.detail(id!) });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Cancel failed'),
  });

  if (!id) return null;
  if (query.isLoading) return <Skeleton className="m-6 h-64" />;
  if (query.error) return <ErrorState title="Could not load production run" error={query.error} />;
  if (!query.data) return null;

  const run = query.data;

  return (
    <div className="mx-auto max-w-3xl space-y-4 px-6 py-8">
      <nav className="text-sm text-fg-muted" aria-label="Breadcrumb">
        <Link to="/production" className="hover:underline">Production runs</Link>
        <span aria-hidden> / </span>
        <span className="text-fg font-mono text-xs">{run.run_number}</span>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold">{run.run_number}</h1>
          <ProductionRunStatusBadge status={run.status} />
        </div>
        <ProductionWorkflowButtons
          status={run.status}
          onStart={() => startMutation.mutate()}
          onComplete={() => completeMutation.mutate()}
          onCancel={() => cancelMutation.mutate()}
          pending={{
            start: startMutation.isPending,
            complete: completeMutation.isPending,
            cancel: cancelMutation.isPending,
          }}
        />
      </header>

      <section className="rounded-md border border-border bg-bg p-4">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">Project</dt>
          <dd className="font-mono text-xs">{run.project_id.slice(0, 8)}…</dd>
          <dt className="text-fg-muted">Target qty</dt>
          <dd className="text-right font-mono">{String(run.qty_target)}</dd>
          <dt className="text-fg-muted">Scheduled for</dt>
          <dd>{run.scheduled_for ? formatDate(run.scheduled_for) : '—'}</dd>
          <dt className="text-fg-muted">Started at</dt>
          <dd>{run.started_at ? formatDate(run.started_at) : '—'}</dd>
          <dt className="text-fg-muted">Completed at</dt>
          <dd>{run.completed_at ? formatDate(run.completed_at) : '—'}</dd>
          <dt className="text-fg-muted">Cancelled at</dt>
          <dd>{run.cancelled_at ? formatDate(run.cancelled_at) : '—'}</dd>
        </dl>
        {run.notes && (
          <p className="mt-3 whitespace-pre-wrap rounded-md bg-bg-muted p-2 text-sm">{run.notes}</p>
        )}
      </section>
    </div>
  );
}

/**
 * Colored badge for production_runs.status (Wave 8d / Phase 13).
 * 4 values verified against the `production_run_state` pg enum.
 */
import { cn } from '@/lib/cn';
import type { ProductionRunState } from '@/lib/workflow';

const STATUS_CLASSES: Record<ProductionRunState, string> = {
  scheduled: 'bg-bg-muted text-fg ring-1 ring-border',
  in_progress: 'bg-info/10 text-info ring-1 ring-info/30',
  completed: 'bg-success/10 text-success ring-1 ring-success/30',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<ProductionRunState, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function ProductionRunStatusBadge({
  status,
  className,
}: {
  status: ProductionRunState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`run-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

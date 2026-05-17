/**
 * Colored badge for production_runs.status (Wave 8d / Phase 13).
 * 4 values verified against the `production_run_state` pg enum.
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { ProductionRunState } from '@/lib/workflow';

const TONE: Record<ProductionRunState, { tone: Tone; label: string }> = {
  scheduled: { tone: 'neutral', label: 'Scheduled' },
  in_progress: { tone: 'info', label: 'In progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function ProductionRunStatusBadge({
  status,
  className,
}: {
  status: ProductionRunState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Production run status: ${label}`}
      testId={`run-status-${status}`}
      className={className}
    />
  );
}

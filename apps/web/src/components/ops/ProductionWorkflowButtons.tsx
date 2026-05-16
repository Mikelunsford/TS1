/**
 * ProductionWorkflowButtons — gates production-run workflow actions on
 * both `can(role, 'production.write')` and `canTransition`.
 *
 * Workflow target mapping (per PRODUCTION_RUN_TRANSITIONS):
 *   Start    : scheduled    → in_progress
 *   Complete : in_progress  → completed
 *   Cancel   : scheduled | in_progress → cancelled
 *
 * Wave 8f / Phase 13.
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type ProductionRunState } from '@/lib/workflow';

import { WorkflowButton } from '../procurement/WorkflowButton';

export interface ProductionWorkflowCallbacks {
  onStart: () => void;
  onComplete: () => void;
  onCancel: () => void;
}

export interface ProductionWorkflowPending {
  start?: boolean;
  complete?: boolean;
  cancel?: boolean;
}

export interface ProductionWorkflowButtonsProps extends ProductionWorkflowCallbacks {
  status: ProductionRunState;
  pending?: ProductionWorkflowPending;
}

export function ProductionWorkflowButtons({
  status,
  onStart,
  onComplete,
  onCancel,
  pending = {},
}: ProductionWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: ProductionRunState) =>
    status !== target && canTransition('production_run', status, target);

  const showStart = can('production.write') && isReal('in_progress');
  const showComplete = can('production.write') && isReal('completed');
  const showCancel = can('production.write') && isReal('cancelled');

  return (
    <div className="flex flex-wrap gap-2" data-testid="run-workflow-buttons">
      {showStart && (
        <WorkflowButton
          data-testid="run-action-start"
          variant="primary"
          onClick={onStart}
          pending={pending.start ?? false}
        >
          Start
        </WorkflowButton>
      )}
      {showComplete && (
        <WorkflowButton
          data-testid="run-action-complete"
          variant="primary"
          onClick={onComplete}
          pending={pending.complete ?? false}
        >
          Complete
        </WorkflowButton>
      )}
      {showCancel && (
        <WorkflowButton
          data-testid="run-action-cancel"
          variant="danger"
          onClick={onCancel}
          pending={pending.cancel ?? false}
        >
          Cancel
        </WorkflowButton>
      )}
    </div>
  );
}

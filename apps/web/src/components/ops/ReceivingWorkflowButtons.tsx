/**
 * ReceivingWorkflowButtons — gates the receiving-order workflow actions
 * on both `can(role, cap)` and `canTransition('receiving_order', from, to)`.
 *
 * Workflow target mapping (per RECEIVING_ORDER_TRANSITIONS):
 *   Receive : open | partial → partial | received (opens receive dialog)
 *   Cancel  : open | partial → cancelled
 *
 * Wave 8f / Phase 13.
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type ReceivingOrderState } from '@/lib/workflow';

import { WorkflowButton } from '../procurement/WorkflowButton';

export interface ReceivingWorkflowCallbacks {
  onReceive: () => void;
  onCancel: () => void;
}

export interface ReceivingWorkflowPending {
  receive?: boolean;
  cancel?: boolean;
}

export interface ReceivingWorkflowButtonsProps extends ReceivingWorkflowCallbacks {
  status: ReceivingOrderState;
  pending?: ReceivingWorkflowPending;
}

export function ReceivingWorkflowButtons({
  status,
  onReceive,
  onCancel,
  pending = {},
}: ReceivingWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const canReceive =
    can('receiving.write') &&
    (canTransition('receiving_order', status, 'partial') ||
      canTransition('receiving_order', status, 'received')) &&
    status !== 'received' &&
    status !== 'cancelled';
  const canCancel =
    can('receiving.write') &&
    canTransition('receiving_order', status, 'cancelled') &&
    status !== 'cancelled';

  return (
    <div className="flex flex-wrap gap-2" data-testid="ro-workflow-buttons">
      {canReceive && (
        <WorkflowButton
          data-testid="ro-action-receive"
          variant="primary"
          onClick={onReceive}
          pending={pending.receive ?? false}
        >
          Receive…
        </WorkflowButton>
      )}
      {canCancel && (
        <WorkflowButton
          data-testid="ro-action-cancel"
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

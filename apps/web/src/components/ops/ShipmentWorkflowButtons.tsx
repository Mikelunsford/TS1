/**
 * ShipmentWorkflowButtons — gates shipment workflow actions on both
 * `can(role, 'shipping.write')` and `canTransition`.
 *
 * Workflow target mapping (per SHIPMENT_TRANSITIONS):
 *   Start loading : scheduled         → loading
 *   Ship          : loading           → shipped
 *   Cancel        : scheduled|loading → cancelled
 *
 * Wave 8f / Phase 13.
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type ShipmentState } from '@/lib/workflow';

import { WorkflowButton } from '../procurement/WorkflowButton';

export interface ShipmentWorkflowCallbacks {
  onStartLoading: () => void;
  onShip: () => void;
  onCancel: () => void;
}

export interface ShipmentWorkflowPending {
  startLoading?: boolean;
  ship?: boolean;
  cancel?: boolean;
}

export interface ShipmentWorkflowButtonsProps extends ShipmentWorkflowCallbacks {
  status: ShipmentState;
  pending?: ShipmentWorkflowPending;
}

export function ShipmentWorkflowButtons({
  status,
  onStartLoading,
  onShip,
  onCancel,
  pending = {},
}: ShipmentWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: ShipmentState) =>
    status !== target && canTransition('shipment', status, target);

  const showStartLoading = can('shipping.write') && isReal('loading');
  const showShip = can('shipping.write') && isReal('shipped');
  const showCancel = can('shipping.write') && isReal('cancelled');

  return (
    <div className="flex flex-wrap gap-2" data-testid="shipment-workflow-buttons">
      {showStartLoading && (
        <WorkflowButton
          data-testid="shipment-action-start-loading"
          variant="primary"
          onClick={onStartLoading}
          pending={pending.startLoading ?? false}
        >
          Start loading
        </WorkflowButton>
      )}
      {showShip && (
        <WorkflowButton
          data-testid="shipment-action-ship"
          variant="primary"
          onClick={onShip}
          pending={pending.ship ?? false}
        >
          Mark shipped
        </WorkflowButton>
      )}
      {showCancel && (
        <WorkflowButton
          data-testid="shipment-action-cancel"
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

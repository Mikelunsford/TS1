/**
 * PurchaseOrderWorkflowButtons — gates the PO workflow actions on both
 * `can(role, cap)` and `canTransition('purchase_order', from, to)`.
 *
 * Workflow target mapping (per `PURCHASE_ORDER_TRANSITIONS` in lib/workflow.ts):
 *   Submit  : draft            → submitted
 *   Approve : submitted        → approved
 *   Receive : approved | partial_received → partial_received | received
 *             (opens POReceiveDialog — handler decides terminal state)
 *   Close   : received         → closed
 *   Cancel  : any non-terminal → cancelled
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type PurchaseOrderState } from '@/lib/workflow';

import { WorkflowButton } from './WorkflowButton';

export interface PurchaseOrderWorkflowCallbacks {
  onSubmit: () => void;
  onApprove: () => void;
  onReceive: () => void;
  onClose: () => void;
  onCancel: () => void;
}

export interface PurchaseOrderWorkflowPending {
  submit?: boolean;
  approve?: boolean;
  receive?: boolean;
  closePending?: boolean;
  cancelPending?: boolean;
}

export interface PurchaseOrderWorkflowButtonsProps extends PurchaseOrderWorkflowCallbacks {
  status: PurchaseOrderState;
  pending?: PurchaseOrderWorkflowPending;
}

export function PurchaseOrderWorkflowButtons({
  status,
  onSubmit,
  onApprove,
  onReceive,
  onClose,
  onCancel,
  pending = {},
}: PurchaseOrderWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: PurchaseOrderState) =>
    status !== target && canTransition('purchase_order', status, target);

  const showSubmit = can('purchase_orders.submit') && isReal('submitted');
  const showApprove = can('purchase_orders.approve') && isReal('approved');
  // Receive opens the partial-receive dialog. Visible when transitioning to
  // either partial_received or received is legal.
  const showReceive =
    can('purchase_orders.receive') &&
    (isReal('partial_received') || isReal('received'));
  const showClose = can('purchase_orders.close') && isReal('closed');
  const showCancel = can('purchase_orders.cancel') && isReal('cancelled');

  return (
    <div className="flex flex-wrap gap-2" data-testid="po-workflow-buttons">
      {showSubmit && (
        <WorkflowButton
          data-testid="po-action-submit"
          variant="primary"
          onClick={onSubmit}
          pending={pending.submit ?? false}
        >
          Submit
        </WorkflowButton>
      )}
      {showApprove && (
        <WorkflowButton
          data-testid="po-action-approve"
          variant="primary"
          onClick={onApprove}
          pending={pending.approve ?? false}
        >
          Approve
        </WorkflowButton>
      )}
      {showReceive && (
        <WorkflowButton
          data-testid="po-action-receive"
          onClick={onReceive}
          pending={pending.receive ?? false}
        >
          Receive…
        </WorkflowButton>
      )}
      {showClose && (
        <WorkflowButton
          data-testid="po-action-close"
          onClick={onClose}
          pending={pending.closePending ?? false}
        >
          Close
        </WorkflowButton>
      )}
      {showCancel && (
        <WorkflowButton
          data-testid="po-action-cancel"
          variant="danger"
          onClick={onCancel}
          pending={pending.cancelPending ?? false}
        >
          Cancel
        </WorkflowButton>
      )}
    </div>
  );
}

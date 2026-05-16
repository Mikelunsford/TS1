/**
 * VendorBillWorkflowButtons — gates the 4 vendor-bill workflow actions on
 * cap + transition legality.
 *
 * Workflow target mapping (per `VENDOR_BILL_TRANSITIONS` in lib/workflow.ts):
 *   Submit  : draft → pending
 *   Approve : pending → approved
 *   Pay     : approved | partially_paid | overdue → partially_paid | paid
 *             (opens VendorBillPayDialog — handler picks terminal state)
 *   Cancel  : any non-terminal pre-paid → cancelled
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type VendorBillState } from '@/lib/workflow';

import { WorkflowButton } from './WorkflowButton';

export interface VendorBillWorkflowCallbacks {
  onSubmit: () => void;
  onApprove: () => void;
  onPay: () => void;
  onCancel: () => void;
}

export interface VendorBillWorkflowPending {
  submit?: boolean;
  approve?: boolean;
  pay?: boolean;
  cancelPending?: boolean;
}

export interface VendorBillWorkflowButtonsProps extends VendorBillWorkflowCallbacks {
  status: VendorBillState;
  pending?: VendorBillWorkflowPending;
}

export function VendorBillWorkflowButtons({
  status,
  onSubmit,
  onApprove,
  onPay,
  onCancel,
  pending = {},
}: VendorBillWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: VendorBillState) =>
    status !== target && canTransition('vendor_bill', status, target);

  const showSubmit = can('vendor_bills.submit') && isReal('pending');
  const showApprove = can('vendor_bills.approve') && isReal('approved');
  // Pay is visible when a payment can advance the bill to either
  // partially_paid or paid.
  const showPay =
    can('vendor_bills.pay') && (isReal('partially_paid') || isReal('paid'));
  const showCancel = can('vendor_bills.cancel') && isReal('cancelled');

  return (
    <div className="flex flex-wrap gap-2" data-testid="vendor-bill-workflow-buttons">
      {showSubmit && (
        <WorkflowButton
          data-testid="vb-action-submit"
          variant="primary"
          onClick={onSubmit}
          pending={pending.submit ?? false}
        >
          Submit
        </WorkflowButton>
      )}
      {showApprove && (
        <WorkflowButton
          data-testid="vb-action-approve"
          variant="primary"
          onClick={onApprove}
          pending={pending.approve ?? false}
        >
          Approve
        </WorkflowButton>
      )}
      {showPay && (
        <WorkflowButton
          data-testid="vb-action-pay"
          onClick={onPay}
          pending={pending.pay ?? false}
        >
          Pay…
        </WorkflowButton>
      )}
      {showCancel && (
        <WorkflowButton
          data-testid="vb-action-cancel"
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

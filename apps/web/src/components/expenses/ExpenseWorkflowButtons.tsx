/**
 * ExpenseWorkflowButtons — gates the 5 expense workflow actions on cap +
 * transition legality.
 *
 * Workflow target mapping (per `EXPENSE_TRANSITIONS` in lib/workflow.ts):
 *   Submit     : draft | rejected → submitted
 *   Approve    : submitted → approved
 *   Reject     : submitted → rejected (opens reason prompt)
 *   Reimburse  : approved → reimbursed
 *   Pay        : approved → paid
 *
 * There is NO cancel — rejected rows are re-edited and resubmitted instead.
 */
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type ExpenseState } from '@/lib/workflow';

import { WorkflowButton } from '@/components/procurement/WorkflowButton';

export interface ExpenseWorkflowCallbacks {
  onSubmit: () => void;
  onApprove: () => void;
  onReject: () => void;
  onReimburse: () => void;
  onPay: () => void;
}

export interface ExpenseWorkflowPending {
  submit?: boolean;
  approve?: boolean;
  reject?: boolean;
  reimburse?: boolean;
  pay?: boolean;
}

export interface ExpenseWorkflowButtonsProps extends ExpenseWorkflowCallbacks {
  status: ExpenseState;
  pending?: ExpenseWorkflowPending;
}

export function ExpenseWorkflowButtons({
  status,
  onSubmit,
  onApprove,
  onReject,
  onReimburse,
  onPay,
  pending = {},
}: ExpenseWorkflowButtonsProps) {
  const { can } = useCapabilities();

  const isReal = (target: ExpenseState) =>
    status !== target && canTransition('expense', status, target);

  const showSubmit = can('expenses.submit') && isReal('submitted');
  const showApprove = can('expenses.approve') && isReal('approved');
  const showReject = can('expenses.approve') && isReal('rejected');
  const showReimburse = can('expenses.pay') && isReal('reimbursed');
  const showPay = can('expenses.pay') && isReal('paid');

  return (
    <div className="flex flex-wrap gap-2" data-testid="expense-workflow-buttons">
      {showSubmit && (
        <WorkflowButton
          data-testid="exp-action-submit"
          variant="primary"
          onClick={onSubmit}
          pending={pending.submit ?? false}
        >
          Submit
        </WorkflowButton>
      )}
      {showApprove && (
        <WorkflowButton
          data-testid="exp-action-approve"
          variant="primary"
          onClick={onApprove}
          pending={pending.approve ?? false}
        >
          Approve
        </WorkflowButton>
      )}
      {showReject && (
        <WorkflowButton
          data-testid="exp-action-reject"
          variant="danger"
          onClick={onReject}
          pending={pending.reject ?? false}
        >
          Reject…
        </WorkflowButton>
      )}
      {showReimburse && (
        <WorkflowButton
          data-testid="exp-action-reimburse"
          onClick={onReimburse}
          pending={pending.reimburse ?? false}
        >
          Reimburse
        </WorkflowButton>
      )}
      {showPay && (
        <WorkflowButton
          data-testid="exp-action-pay"
          onClick={onPay}
          pending={pending.pay ?? false}
        >
          Pay
        </WorkflowButton>
      )}
    </div>
  );
}

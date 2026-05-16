/**
 * Colored badge for expenses.status (6 values, verified against
 * schema_migrations=0058 / prod `expenses.status` text CHECK). No
 * `cancelled` state — rejected expenses can be resubmitted.
 */
import { cn } from '@/lib/cn';
import type { ExpenseState } from '@/lib/workflow';

const STATUS_CLASSES: Record<ExpenseState, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  submitted: 'bg-info/10 text-info ring-1 ring-info/30',
  approved: 'bg-info/10 text-info ring-1 ring-info/30',
  rejected: 'bg-danger/10 text-danger ring-1 ring-danger/30',
  reimbursed: 'bg-success/10 text-success ring-1 ring-success/30',
  paid: 'bg-success/10 text-success ring-1 ring-success/30',
};

const STATUS_LABELS: Record<ExpenseState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  reimbursed: 'Reimbursed',
  paid: 'Paid',
};

export function ExpenseStatusBadge({
  status,
  className,
}: {
  status: ExpenseState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`expense-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

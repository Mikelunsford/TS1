/**
 * Colored badge for expenses.status (6 values, verified against
 * schema_migrations=0058 / prod `expenses.status` text CHECK). No
 * `cancelled` state — rejected expenses can be resubmitted.
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { ExpenseState } from '@/lib/workflow';

const TONE: Record<ExpenseState, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'info', label: 'Submitted' },
  approved: { tone: 'info', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  reimbursed: { tone: 'success', label: 'Reimbursed' },
  paid: { tone: 'success', label: 'Paid' },
};

export function ExpenseStatusBadge({
  status,
  className,
}: {
  status: ExpenseState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Expense status: ${label}`}
      testId={`expense-status-${status}`}
      className={className}
    />
  );
}

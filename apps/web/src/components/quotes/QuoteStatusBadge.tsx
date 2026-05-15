/**
 * Colored badge for a quote's `status` enum value. Status color map mirrors
 * the same tone vocabulary the lead/opportunity badges use, but is keyed on
 * the prod `quote_state` enum (verified 2026-05-15 against schema_migrations
 * 0050).
 */
import { cn } from '@/lib/cn';
import type { QuoteState } from '@/lib/types';

const STATUS_CLASSES: Record<QuoteState, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  submitted: 'bg-info/10 text-info ring-1 ring-info/30',
  revise_requested: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  approved: 'bg-success/10 text-success ring-1 ring-success/30',
  project_pending: 'bg-success/10 text-success ring-1 ring-success/30',
  cancelled: 'bg-danger/10 text-danger ring-1 ring-danger/30',
};

const STATUS_LABELS: Record<QuoteState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  revise_requested: 'Revise requested',
  approved: 'Approved',
  project_pending: 'Project pending',
  cancelled: 'Cancelled',
};

export function QuoteStatusBadge({
  status,
  className,
}: {
  status: QuoteState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

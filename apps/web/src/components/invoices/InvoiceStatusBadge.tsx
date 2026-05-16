/**
 * Colored badge for an invoice's `status` enum (9 values, verified against
 * schema_migrations=0052 / prod `invoices.status` text CHECK). Mirrors the
 * tone vocabulary of QuoteStatusBadge.
 */
import { cn } from '@/lib/cn';
import type { InvoiceState } from '@/lib/types';

const STATUS_CLASSES: Record<InvoiceState, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  pending: 'bg-info/10 text-info ring-1 ring-info/30',
  sent: 'bg-info/10 text-info ring-1 ring-info/30',
  partially_paid: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  paid: 'bg-success/10 text-success ring-1 ring-success/30',
  overdue: 'bg-danger/10 text-danger ring-1 ring-danger/30',
  on_hold: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  refunded: 'bg-bg-muted text-fg-muted ring-1 ring-border',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<InvoiceState, string> = {
  draft: 'Draft',
  pending: 'Pending',
  sent: 'Sent',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  on_hold: 'On hold',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`invoice-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

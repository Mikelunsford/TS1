/**
 * Colored badge for purchase_orders.status (7 values, verified against
 * schema_migrations=0058 / prod `purchase_orders.status` text CHECK).
 *
 * Constitutional invariant: state spelling is `partial_received` (one r).
 */
import { cn } from '@/lib/cn';
import type { PurchaseOrderState } from '@/lib/workflow';

const STATUS_CLASSES: Record<PurchaseOrderState, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  submitted: 'bg-info/10 text-info ring-1 ring-info/30',
  approved: 'bg-info/10 text-info ring-1 ring-info/30',
  partial_received: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  received: 'bg-success/10 text-success ring-1 ring-success/30',
  closed: 'bg-success/10 text-success ring-1 ring-success/30',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<PurchaseOrderState, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  approved: 'Approved',
  partial_received: 'Partially received',
  received: 'Received',
  closed: 'Closed',
  cancelled: 'Cancelled',
};

export function PurchaseOrderStatusBadge({
  status,
  className,
}: {
  status: PurchaseOrderState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`po-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

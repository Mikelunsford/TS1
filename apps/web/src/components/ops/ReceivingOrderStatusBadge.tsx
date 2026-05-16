/**
 * Colored badge for receiving_orders.status (Wave 8d / Phase 13).
 * 4 values verified against the `receiving_order_state` pg enum.
 */
import { cn } from '@/lib/cn';
import type { ReceivingOrderState } from '@/lib/workflow';

const STATUS_CLASSES: Record<ReceivingOrderState, string> = {
  open: 'bg-bg-muted text-fg ring-1 ring-border',
  partial: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  received: 'bg-success/10 text-success ring-1 ring-success/30',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<ReceivingOrderState, string> = {
  open: 'Open',
  partial: 'Partially received',
  received: 'Received',
  cancelled: 'Cancelled',
};

export function ReceivingOrderStatusBadge({
  status,
  className,
}: {
  status: ReceivingOrderState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`ro-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Colored badge for shipments.status (Wave 8d / Phase 13).
 * 4 values verified against the `shipment_state` pg enum.
 */
import { cn } from '@/lib/cn';
import type { ShipmentState } from '@/lib/workflow';

const STATUS_CLASSES: Record<ShipmentState, string> = {
  scheduled: 'bg-bg-muted text-fg ring-1 ring-border',
  loading: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  shipped: 'bg-success/10 text-success ring-1 ring-success/30',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<ShipmentState, string> = {
  scheduled: 'Scheduled',
  loading: 'Loading',
  shipped: 'Shipped',
  cancelled: 'Cancelled',
};

export function ShipmentStatusBadge({
  status,
  className,
}: {
  status: ShipmentState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`shipment-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

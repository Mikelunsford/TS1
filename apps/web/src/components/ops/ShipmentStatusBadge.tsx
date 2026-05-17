/**
 * Colored badge for shipments.status (Wave 8d / Phase 13).
 * 4 values verified against the `shipment_state` pg enum.
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { ShipmentState } from '@/lib/workflow';

const TONE: Record<ShipmentState, { tone: Tone; label: string }> = {
  scheduled: { tone: 'neutral', label: 'Scheduled' },
  loading: { tone: 'warning', label: 'Loading' },
  shipped: { tone: 'success', label: 'Shipped' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function ShipmentStatusBadge({
  status,
  className,
}: {
  status: ShipmentState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Shipment status: ${label}`}
      testId={`shipment-status-${status}`}
      className={className}
    />
  );
}

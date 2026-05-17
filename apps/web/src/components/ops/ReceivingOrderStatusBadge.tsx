/**
 * Colored badge for receiving_orders.status (Wave 8d / Phase 13).
 * 4 values verified against the `receiving_order_state` pg enum.
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { ReceivingOrderState } from '@/lib/workflow';

const TONE: Record<ReceivingOrderState, { tone: Tone; label: string }> = {
  open: { tone: 'neutral', label: 'Open' },
  partial: { tone: 'warning', label: 'Partially received' },
  received: { tone: 'success', label: 'Received' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function ReceivingOrderStatusBadge({
  status,
  className,
}: {
  status: ReceivingOrderState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Receiving order status: ${label}`}
      testId={`ro-status-${status}`}
      className={className}
    />
  );
}

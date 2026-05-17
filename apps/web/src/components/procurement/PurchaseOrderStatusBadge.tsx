/**
 * Colored badge for purchase_orders.status (7 values, verified against
 * schema_migrations=0058 / prod `purchase_orders.status` text CHECK).
 *
 * Constitutional invariant: state spelling is `partial_received` (one r).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>. The
 * audit called out that `received` and `closed` rendered identically
 * (both emerald) — both terminal but only `received` should imply "won"
 * brightness. `closed` now uses `tone='muted'` so the two terminal states
 * are visually distinguishable.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { PurchaseOrderState } from '@/lib/workflow';

const TONE: Record<PurchaseOrderState, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'info', label: 'Submitted' },
  approved: { tone: 'info', label: 'Approved' },
  partial_received: { tone: 'warning', label: 'Partially received' },
  received: { tone: 'success', label: 'Received' },
  closed: { tone: 'muted', label: 'Closed' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function PurchaseOrderStatusBadge({
  status,
  className,
}: {
  status: PurchaseOrderState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Purchase order status: ${label}`}
      testId={`po-status-${status}`}
      className={className}
    />
  );
}

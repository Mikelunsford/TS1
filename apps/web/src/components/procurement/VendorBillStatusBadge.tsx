/**
 * Colored badge for vendor_bills.status (7 values, verified against
 * schema_migrations=0058 / prod `vendor_bills.status` text CHECK).
 */
import { cn } from '@/lib/cn';
import type { VendorBillState } from '@/lib/workflow';

const STATUS_CLASSES: Record<VendorBillState, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  pending: 'bg-info/10 text-info ring-1 ring-info/30',
  approved: 'bg-info/10 text-info ring-1 ring-info/30',
  partially_paid: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  paid: 'bg-success/10 text-success ring-1 ring-success/30',
  overdue: 'bg-danger/10 text-danger ring-1 ring-danger/30',
  cancelled: 'bg-bg-muted text-fg-muted ring-1 ring-border',
};

const STATUS_LABELS: Record<VendorBillState, string> = {
  draft: 'Draft',
  pending: 'Pending',
  approved: 'Approved',
  partially_paid: 'Partially paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export function VendorBillStatusBadge({
  status,
  className,
}: {
  status: VendorBillState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
      data-testid={`vendor-bill-status-${status}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

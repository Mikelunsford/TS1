/**
 * Colored badge for vendor_bills.status (7 values, verified against
 * schema_migrations=0058 / prod `vendor_bills.status` text CHECK).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { VendorBillState } from '@/lib/workflow';

const TONE: Record<VendorBillState, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  pending: { tone: 'info', label: 'Pending' },
  approved: { tone: 'info', label: 'Approved' },
  partially_paid: { tone: 'warning', label: 'Partially paid' },
  paid: { tone: 'success', label: 'Paid' },
  overdue: { tone: 'danger', label: 'Overdue' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function VendorBillStatusBadge({
  status,
  className,
}: {
  status: VendorBillState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Vendor bill status: ${label}`}
      testId={`vendor-bill-status-${status}`}
      className={className}
    />
  );
}

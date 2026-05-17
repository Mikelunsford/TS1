/**
 * Colored badge for an invoice's `payment_status` enum (3 values: unpaid,
 * partially_paid, paid).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { InvoicePaymentStatus } from '@/lib/types';

const TONE: Record<InvoicePaymentStatus, { tone: Tone; label: string }> = {
  unpaid: { tone: 'muted', label: 'Unpaid' },
  partially_paid: { tone: 'warning', label: 'Partially paid' },
  paid: { tone: 'success', label: 'Paid' },
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: InvoicePaymentStatus;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Payment status: ${label}`}
      testId={`payment-status-${status}`}
      className={className}
    />
  );
}

/**
 * Colored badge for an invoice's `payment_status` enum (3 values: unpaid,
 * partially_paid, paid). Drives off `InvoicePaymentStatus`.
 */
import { cn } from '@/lib/cn';
import type { InvoicePaymentStatus } from '@/lib/types';

const CLASSES: Record<InvoicePaymentStatus, string> = {
  unpaid: 'bg-bg-muted text-fg-muted ring-1 ring-border',
  partially_paid: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  paid: 'bg-success/10 text-success ring-1 ring-success/30',
};

const LABELS: Record<InvoicePaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partially paid',
  paid: 'Paid',
};

export function PaymentStatusBadge({
  status,
  className,
}: {
  status: InvoicePaymentStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        CLASSES[status],
        className,
      )}
      data-testid={`payment-status-${status}`}
    >
      {LABELS[status]}
    </span>
  );
}

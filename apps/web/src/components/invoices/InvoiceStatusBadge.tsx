/**
 * Colored badge for an invoice's `status` enum (9 values, verified against
 * schema_migrations=0052 / prod `invoices.status` text CHECK).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around the shared
 * <StatusBadge> primitive. Tone vocabulary unchanged; aria-label and
 * data-testid preserved.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { InvoiceState } from '@/lib/types';

const TONE: Record<InvoiceState, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  pending: { tone: 'info', label: 'Pending' },
  sent: { tone: 'info', label: 'Sent' },
  partially_paid: { tone: 'warning', label: 'Partially paid' },
  paid: { tone: 'success', label: 'Paid' },
  overdue: { tone: 'danger', label: 'Overdue' },
  on_hold: { tone: 'warning', label: 'On hold' },
  refunded: { tone: 'muted', label: 'Refunded' },
  cancelled: { tone: 'muted', label: 'Cancelled' },
};

export function InvoiceStatusBadge({
  status,
  className,
}: {
  status: InvoiceState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Invoice status: ${label}`}
      testId={`invoice-status-${status}`}
      className={className}
    />
  );
}

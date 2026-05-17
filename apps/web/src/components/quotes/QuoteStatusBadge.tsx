/**
 * Colored badge for a quote's `status` enum value (6 values, verified against
 * schema_migrations=0050 / prod `quote_state` enum).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { QuoteState } from '@/lib/types';

const TONE: Record<QuoteState, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'info', label: 'Submitted' },
  revise_requested: { tone: 'warning', label: 'Revise requested' },
  approved: { tone: 'success', label: 'Approved' },
  project_pending: { tone: 'success', label: 'Project pending' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
};

export function QuoteStatusBadge({
  status,
  className,
}: {
  status: QuoteState;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Quote status: ${label}`}
      testId={`quote-status-${status}`}
      className={className}
    />
  );
}

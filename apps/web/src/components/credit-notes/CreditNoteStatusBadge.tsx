/**
 * CreditNoteStatusBadge — colored badge for the four credit_notes.status
 * CHECK-constraint values (verified 2026-05-15).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { CreditNoteStatus } from '@/lib/types';

const TONE: Record<CreditNoteStatus, { tone: Tone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  issued: { tone: 'info', label: 'Issued' },
  applied: { tone: 'success', label: 'Applied' },
  voided: { tone: 'danger', label: 'Voided' },
};

export function CreditNoteStatusBadge({
  status,
  className,
}: {
  status: CreditNoteStatus;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Credit note status: ${label}`}
      testId={`credit-note-status-${status}`}
      className={className}
    />
  );
}

/**
 * CreditNoteStatusBadge — colored badge for the four credit_notes.status
 * values (CHECK constraint values, verified 2026-05-15). Mirrors the
 * QuoteStatusBadge tone vocabulary.
 */
import { cn } from '@/lib/cn';
import type { CreditNoteStatus } from '@/lib/types';

const STATUS_CLASSES: Record<CreditNoteStatus, string> = {
  draft: 'bg-bg-muted text-fg ring-1 ring-border',
  issued: 'bg-info/10 text-info ring-1 ring-info/30',
  applied: 'bg-success/10 text-success ring-1 ring-success/30',
  voided: 'bg-danger/10 text-danger ring-1 ring-danger/30',
};

const STATUS_LABELS: Record<CreditNoteStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  applied: 'Applied',
  voided: 'Voided',
};

export function CreditNoteStatusBadge({
  status,
  className,
}: {
  status: CreditNoteStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

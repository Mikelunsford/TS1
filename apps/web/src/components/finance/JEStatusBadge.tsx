/**
 * JE status badge — draft / posted / reversed.
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>. The
 * audit called out that this badge rendered the raw lowercase enum value
 * (`"reversed"`). It now renders a proper label and gets an aria-label.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { JournalEntryState } from '@/lib/workflow';

const TONE: Record<JournalEntryState, { tone: Tone; label: string }> = {
  draft: { tone: 'muted', label: 'Draft' },
  posted: { tone: 'success', label: 'Posted' },
  reversed: { tone: 'warning', label: 'Reversed' },
};

export function JEStatusBadge({ status }: { status: JournalEntryState }) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Journal entry status: ${label}`}
      testId={`je-status-${status}`}
    />
  );
}

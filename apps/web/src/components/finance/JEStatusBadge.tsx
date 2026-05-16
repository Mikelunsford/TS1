/**
 * JE status badge — draft / posted / reversed. Visual treatment mirrors
 * other status badges (InvoiceStatusBadge / VendorBillStatusBadge).
 */
import type { JournalEntryState } from '@/lib/workflow';

const STYLES: Record<JournalEntryState, string> = {
  draft: 'bg-bg-muted text-fg-muted ring-1 ring-border',
  posted: 'bg-success/10 text-success ring-1 ring-success/30',
  reversed: 'bg-warning/10 text-warning ring-1 ring-warning/30',
};

export function JEStatusBadge({ status }: { status: JournalEntryState }) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${STYLES[status]}`}
      data-testid={`je-status-${status}`}
    >
      {status}
    </span>
  );
}

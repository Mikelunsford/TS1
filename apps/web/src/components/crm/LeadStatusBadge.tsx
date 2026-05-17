/**
 * Colored badge for a lead's status enum value (5 values).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>.
 * `converted` was previously rendered with a brand-subtle tint; the audit
 * pass standardises this to the `accent` tone so it's distinguishable from
 * the brand-coloured navigation chrome.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { LeadStatus } from '@/lib/types';

const TONE: Record<LeadStatus, { tone: Tone; label: string }> = {
  new: { tone: 'neutral', label: 'New' },
  contacted: { tone: 'info', label: 'Contacted' },
  qualified: { tone: 'success', label: 'Qualified' },
  disqualified: { tone: 'danger', label: 'Disqualified' },
  converted: { tone: 'accent', label: 'Converted' },
};

export function LeadStatusBadge({
  status,
  className,
}: {
  status: LeadStatus;
  className?: string;
}) {
  const { tone, label } = TONE[status];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Lead status: ${label}`}
      testId={`lead-status-${status}`}
      className={className}
    />
  );
}

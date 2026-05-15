/**
 * Colored badge for a lead's status enum value. Status color map mirrors the
 * design system tokens — bg-* / text-* pairs picked from tailwind.config.ts.
 */
import { cn } from '@/lib/cn';
import type { LeadStatus } from '@/lib/crmTypes';

type Props = {
  status: LeadStatus;
  className?: string;
};

const STATUS_CLASSES: Record<LeadStatus, string> = {
  new: 'bg-bg-subtle text-fg',
  contacted: 'bg-info/15 text-info',
  qualified: 'bg-success/15 text-success',
  disqualified: 'bg-danger/15 text-danger',
  converted: 'bg-brand-subtle text-brand',
};

const STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  disqualified: 'Disqualified',
  converted: 'Converted',
};

export function LeadStatusBadge({ status, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        STATUS_CLASSES[status],
        className,
      )}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

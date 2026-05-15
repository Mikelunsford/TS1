/**
 * Colored badge for an opportunity's stage enum. Stage color map covers all
 * seven values in migration 0032's CHECK constraint.
 */
import { cn } from '@/lib/cn';
import type { OpportunityStage } from '@/lib/crmTypes';

type Props = {
  stage: OpportunityStage;
  className?: string;
};

const STAGE_CLASSES: Record<OpportunityStage, string> = {
  prospect: 'bg-bg-subtle text-fg',
  discovery: 'bg-info/15 text-info',
  proposal: 'bg-accent/15 text-accent',
  negotiation: 'bg-warning/15 text-warning',
  won: 'bg-success/15 text-success',
  lost: 'bg-danger/15 text-danger',
  abandoned: 'bg-bg-muted text-fg-muted',
};

const STAGE_LABELS: Record<OpportunityStage, string> = {
  prospect: 'Prospect',
  discovery: 'Discovery',
  proposal: 'Proposal',
  negotiation: 'Negotiation',
  won: 'Won',
  lost: 'Lost',
  abandoned: 'Abandoned',
};

export function OpportunityStageBadge({ stage, className }: Props) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium',
        STAGE_CLASSES[stage],
        className,
      )}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

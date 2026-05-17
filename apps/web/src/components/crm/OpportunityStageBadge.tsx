/**
 * Colored badge for an opportunity's stage enum (7 values, per migration
 * 0032's CHECK constraint).
 *
 * UI-audit refactor (2026-05-18): thin wrapper around <StatusBadge>. The
 * `proposal` stage uses the `accent` tone (the only consumer of `accent`
 * in the entity-badge vocab — kept distinct from `info` to differentiate
 * "in proposal" from "in discovery").
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { OpportunityStage } from '@/lib/types';

const TONE: Record<OpportunityStage, { tone: Tone; label: string }> = {
  prospect: { tone: 'neutral', label: 'Prospect' },
  discovery: { tone: 'info', label: 'Discovery' },
  proposal: { tone: 'accent', label: 'Proposal' },
  negotiation: { tone: 'warning', label: 'Negotiation' },
  won: { tone: 'success', label: 'Won' },
  lost: { tone: 'danger', label: 'Lost' },
  abandoned: { tone: 'muted', label: 'Abandoned' },
};

export function OpportunityStageBadge({
  stage,
  className,
}: {
  stage: OpportunityStage;
  className?: string;
}) {
  const { tone, label } = TONE[stage];
  return (
    <StatusBadge
      tone={tone}
      label={label}
      ariaLabel={`Opportunity stage: ${label}`}
      testId={`opportunity-stage-${stage}`}
      className={className}
    />
  );
}

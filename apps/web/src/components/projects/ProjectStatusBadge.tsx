import { Badge } from '@/components/ui/Badge';
import type { PhaseStatus, ProjectState } from '@/lib/types';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const projectToneByStatus: Record<ProjectState, Tone> = {
  pending: 'neutral',
  ready_to_build: 'info',
  in_production: 'info',
  ready_to_ship: 'warning',
  completed: 'success',
  cancelled: 'danger',
};

const projectLabelByStatus: Record<ProjectState, string> = {
  pending: 'Pending',
  ready_to_build: 'Ready to Build',
  in_production: 'In Production',
  ready_to_ship: 'Ready to Ship',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/**
 * Project status pill. Maps the prod `project_state` enum onto Badge tones
 * so list and detail views stay consistent. Unknown values render as a
 * neutral pill with the raw text so a future enum addition doesn't crash.
 */
export function ProjectStatusBadge({ status }: { status: string }) {
  if (status in projectToneByStatus) {
    const known = status as ProjectState;
    return <Badge tone={projectToneByStatus[known]}>{projectLabelByStatus[known]}</Badge>;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

const phaseToneByStatus: Record<PhaseStatus, Tone> = {
  pending: 'neutral',
  active: 'info',
  completed: 'success',
  cancelled: 'danger',
};

const phaseLabelByStatus: Record<PhaseStatus, string> = {
  pending: 'Pending',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

/** Phase status pill — mirrors ProjectStatusBadge for the four phase states. */
export function PhaseStatusBadge({ status }: { status: string }) {
  if (status in phaseToneByStatus) {
    const known = status as PhaseStatus;
    return <Badge tone={phaseToneByStatus[known]}>{phaseLabelByStatus[known]}</Badge>;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

/**
 * Project + phase status pills. Maps the prod `project_state` and
 * `phase_status` enums onto the shared <StatusBadge> primitive.
 *
 * UI-audit refactor (2026-05-18): thin wrappers around <StatusBadge>.
 * Public API preserved: callers pass `status: string` (open-enum-safe).
 * Unknown values render as a neutral pill with the raw text so a future
 * enum addition doesn't crash the SPA.
 */
import { StatusBadge, type Tone } from '@/components/ui/StatusBadge';
import type { PhaseStatus, ProjectState } from '@/lib/types';

const PROJECT_TONE: Record<ProjectState, { tone: Tone; label: string }> = {
  pending: { tone: 'neutral', label: 'Pending' },
  ready_to_build: { tone: 'info', label: 'Ready to Build' },
  in_production: { tone: 'info', label: 'In Production' },
  ready_to_ship: { tone: 'warning', label: 'Ready to Ship' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
};

function isProjectState(s: string): s is ProjectState {
  return s in PROJECT_TONE;
}

export function ProjectStatusBadge({ status }: { status: string }) {
  if (isProjectState(status)) {
    const { tone, label } = PROJECT_TONE[status];
    return (
      <StatusBadge
        tone={tone}
        label={label}
        ariaLabel={`Project status: ${label}`}
        testId={`project-status-${status}`}
      />
    );
  }
  return (
    <StatusBadge
      tone="neutral"
      label={status}
      ariaLabel={`Project status: ${status}`}
      testId={`project-status-${status}`}
    />
  );
}

const PHASE_TONE: Record<PhaseStatus, { tone: Tone; label: string }> = {
  pending: { tone: 'neutral', label: 'Pending' },
  active: { tone: 'info', label: 'Active' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'danger', label: 'Cancelled' },
};

function isPhaseStatus(s: string): s is PhaseStatus {
  return s in PHASE_TONE;
}

/** Phase status pill — mirrors ProjectStatusBadge for the four phase states. */
export function PhaseStatusBadge({ status }: { status: string }) {
  if (isPhaseStatus(status)) {
    const { tone, label } = PHASE_TONE[status];
    return (
      <StatusBadge
        tone={tone}
        label={label}
        ariaLabel={`Phase status: ${label}`}
        testId={`phase-status-${status}`}
      />
    );
  }
  return (
    <StatusBadge
      tone="neutral"
      label={status}
      ariaLabel={`Phase status: ${status}`}
      testId={`phase-status-${status}`}
    />
  );
}

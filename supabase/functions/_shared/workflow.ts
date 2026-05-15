/**
 * State-machine matrix for Wave 4 quote / project / phase workflows.
 *
 * This file is BYTE-MIRRORED into `apps/web/src/lib/workflow.ts` so the SPA
 * gates buttons on the same matrix the server enforces. The contract test
 * (`pnpm test:contract`) asserts the two copies are structurally identical.
 *
 * Alignment with prod enums (verified 2026-05-15 against
 * project_id=ozvanymuzaqbexchuoxz, schema_migrations=0050):
 *
 *   quote_state    : draft | submitted | revise_requested | approved |
 *                    project_pending | cancelled
 *   project_state  : pending | in_production | completed | cancelled |
 *                    ready_to_build | ready_to_ship
 *   project_phases.status (text CHECK)
 *                  : pending | active | completed | cancelled
 *
 * The Wave 4 dispatch text proposed quote states `sent / accepted / declined /
 * converted_to_project` which DO NOT exist in the enum. The constitutional
 * invariant "TS state machines preserved verbatim" (TS1/08-database/00-
 * SCHEMA-MASTER.md §15) is the deciding rule. So:
 *
 *   - `POST /quotes/:id/submit`             → draft → submitted
 *   - `POST /quotes/:id/approve`            → submitted → approved
 *   - `POST /quotes/:id/request-revisions`  → submitted → revise_requested
 *   - `POST /quotes/:id/decline`            → submitted|approved → cancelled
 *   - `POST /quotes/:id/convert-to-project` → approved → project_pending
 *   - `POST /quotes/:id/send`               → NO state change; activity row only
 *   - `POST /quotes/:id/accept`             → NO state change; activity row only
 *
 * R-W4-PF-01 (closed) tracks the divergence; the original dispatch
 * verbs are preserved as the SPA-facing route names but their semantics
 * are bound to the existing enum.
 */

export type QuoteState =
  | 'draft'
  | 'submitted'
  | 'revise_requested'
  | 'approved'
  | 'project_pending'
  | 'cancelled';

export type ProjectState =
  | 'pending'
  | 'ready_to_build'
  | 'in_production'
  | 'ready_to_ship'
  | 'completed'
  | 'cancelled';

export type PhaseStatus = 'pending' | 'active' | 'completed' | 'cancelled';

/**
 * Quote transitions matrix. Every (from -> to) listed here is a legal real
 * state change. Endpoints whose semantics are timestamp/activity-only (send,
 * accept) DO NOT appear here; the handler stamps state_changed_at + emits an
 * activity row without invoking assertTransition.
 */
export const QUOTE_TRANSITIONS: Record<QuoteState, readonly QuoteState[]> = {
  draft: ['submitted', 'cancelled'],
  submitted: ['approved', 'revise_requested', 'cancelled'],
  revise_requested: ['submitted', 'cancelled'],
  approved: ['project_pending', 'cancelled'],
  project_pending: ['cancelled'],
  cancelled: [],
};

/**
 * Project transitions matrix. Lifecycle: pending -> ready_to_build ->
 * in_production -> ready_to_ship -> completed. `cancelled` reachable from any
 * non-terminal state. `reopen` (completed -> in_production or ready_to_ship)
 * is a backstop and not part of the forward path; it lives here so the helper
 * can validate it.
 */
export const PROJECT_TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  pending: ['ready_to_build', 'in_production', 'cancelled'],
  ready_to_build: ['in_production', 'cancelled'],
  in_production: ['ready_to_ship', 'completed', 'cancelled'],
  ready_to_ship: ['completed', 'cancelled'],
  completed: ['in_production', 'ready_to_ship'], // reopen path
  cancelled: [],
};

/**
 * Phase transitions matrix. Phase status is plain text + CHECK constraint on
 * the DB (not an enum), but the allowed transitions are the same shape as the
 * quote / project matrices.
 */
export const PHASE_TRANSITIONS: Record<PhaseStatus, readonly PhaseStatus[]> = {
  pending: ['active', 'cancelled'],
  active: ['completed', 'cancelled'],
  completed: ['active'],
  cancelled: [],
};

export type WorkflowMachine = 'quote' | 'project' | 'phase';

type Matrix = Record<string, readonly string[]>;

function getMatrix(machine: WorkflowMachine): Matrix {
  switch (machine) {
    case 'quote':
      return QUOTE_TRANSITIONS as Matrix;
    case 'project':
      return PROJECT_TRANSITIONS as Matrix;
    case 'phase':
      return PHASE_TRANSITIONS as Matrix;
  }
}

/**
 * Return true if `from -> to` is a legal transition for the named machine.
 * Idempotent: `from === to` is always allowed (callers stamping a row a
 * second time with the same status should not 409 themselves).
 */
export function canTransition(
  machine: WorkflowMachine,
  from: string,
  to: string,
): boolean {
  if (from === to) return true;
  const matrix = getMatrix(machine);
  const allowed = matrix[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

/**
 * Throw a STATE_CONFLICT shape when the transition is illegal. Handlers
 * catch the thrown ApiError and route it through `fromApiError` / the
 * envelope helper. The error is a plain Error subclass on this layer to
 * avoid a circular import with responses.ts; handlers re-wrap via
 * `throw new ApiError('STATE_CONFLICT', err.message, 409)`.
 */
export class WorkflowError extends Error {
  readonly machine: WorkflowMachine;
  readonly from: string;
  readonly to: string;
  constructor(machine: WorkflowMachine, from: string, to: string) {
    super(
      `workflow ${machine}: illegal transition ${from} -> ${to}`,
    );
    this.machine = machine;
    this.from = from;
    this.to = to;
    this.name = 'WorkflowError';
  }
}

export function assertTransition(
  machine: WorkflowMachine,
  from: string,
  to: string,
): void {
  if (!canTransition(machine, from, to)) {
    throw new WorkflowError(machine, from, to);
  }
}

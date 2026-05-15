import { describe, it, expect } from 'vitest';

import {
  PHASE_TRANSITIONS,
  assertTransition,
  canTransition,
  type PhaseStatus,
} from '@/lib/workflow';

/**
 * Phase workflow state-machine wire-contract parity.
 *
 * From TS1/09-api/00-API-CONTRACT.md §5.2 + PR #38 BE handlers
 * (supabase/functions/projects-api/handlers/phases.ts):
 *
 *   PUT /projects/:project_id/phases/:phase_id/status
 *     calls `assertTransition('phase', existing.status, body.status)` where
 *     body.status ∈ PhaseStatusSchema = {pending, active, completed, cancelled}.
 *
 * The matrix MUST permit every transition that the UI can drive — typical
 * forward path is pending → active → completed; cancel is reachable from
 * pending and active; completed → active is the reopen-phase backstop.
 */

interface ImpliedTransition {
  verb: string;
  from: PhaseStatus;
  to: PhaseStatus;
  legal: boolean;
}

const IMPLIED_TRANSITIONS: ReadonlyArray<ImpliedTransition> = [
  // Forward path
  { verb: 'PUT /phases/:id/status (pending -> active)', from: 'pending', to: 'active', legal: true },
  { verb: 'PUT /phases/:id/status (active -> completed)', from: 'active', to: 'completed', legal: true },
  // Cancel
  { verb: 'PUT /phases/:id/status (pending -> cancelled)', from: 'pending', to: 'cancelled', legal: true },
  { verb: 'PUT /phases/:id/status (active -> cancelled)', from: 'active', to: 'cancelled', legal: true },
  // Reopen
  { verb: 'PUT /phases/:id/status (completed -> active) reopen', from: 'completed', to: 'active', legal: true },
  // Illegal
  { verb: 'PUT /phases/:id/status (pending -> completed) skips active', from: 'pending', to: 'completed', legal: false },
  { verb: 'PUT /phases/:id/status (cancelled -> active) is REJECTED', from: 'cancelled', to: 'active', legal: false },
];

describe('workflow contract: PUT /phases/:id/status  ↔ PHASE_TRANSITIONS', () => {
  it('every (from, to) implied by an API verb has the expected legality', () => {
    for (const { verb, from, to, legal } of IMPLIED_TRANSITIONS) {
      expect(canTransition('phase', from, to), verb).toBe(legal);
      if (legal) {
        expect(() => assertTransition('phase', from, to)).not.toThrow();
      } else {
        expect(() => assertTransition('phase', from, to)).toThrow();
      }
    }
  });

  it('cancelled is terminal', () => {
    expect(PHASE_TRANSITIONS.cancelled.length).toBe(0);
  });

  it('matrix matches PhaseStatusSchema enum', () => {
    const expected: PhaseStatus[] = ['pending', 'active', 'completed', 'cancelled'];
    expect(Object.keys(PHASE_TRANSITIONS).sort()).toEqual([...expected].sort());
  });
});

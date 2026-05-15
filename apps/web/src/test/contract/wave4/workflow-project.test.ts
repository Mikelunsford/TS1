import { describe, it, expect } from 'vitest';

import {
  PROJECT_TRANSITIONS,
  assertTransition,
  canTransition,
  type ProjectState,
} from '@/lib/workflow';

/**
 * Project workflow state-machine wire-contract parity.
 *
 * From TS1/09-api/00-API-CONTRACT.md §5.1 + PR #38 BE handlers
 * (supabase/functions/projects-api/handlers/projects.ts):
 *
 *   POST /projects/:id/close   — any non-terminal/non-completed → completed
 *   POST /projects/:id/reopen  — completed → in_production | ready_to_ship
 *
 * `close` calls `assertTransition('project', existing.status, 'completed')`
 * unconditionally. The matrix MUST permit `completed` as a target from every
 * state that the handler accepts as a current status. Per PROJECT_TRANSITIONS:
 *   in_production -> completed   ✓
 *   ready_to_ship -> completed   ✓
 *   pending       -> completed   ✗ (must go through in_production first)
 *   ready_to_build-> completed   ✗ (must go through in_production first)
 * The handler will (correctly) 409 if a caller closes from pending. That's
 * intended behaviour.
 *
 * `reopen` accepts `body.to ∈ {in_production, ready_to_ship}` (validated by
 * ProjectReopenSchema, defaulting to in_production). Both targets MUST be
 * reachable from `completed`.
 */

interface ImpliedTransition {
  verb: string;
  from: ProjectState;
  to: ProjectState;
  legal: boolean;
}

const IMPLIED_TRANSITIONS: ReadonlyArray<ImpliedTransition> = [
  // /close — legal endpoints
  { verb: 'POST /projects/:id/close (from in_production)', from: 'in_production', to: 'completed', legal: true },
  { verb: 'POST /projects/:id/close (from ready_to_ship)', from: 'ready_to_ship', to: 'completed', legal: true },
  // /close — illegal endpoints (handler 409s)
  { verb: 'POST /projects/:id/close (from pending) is REJECTED', from: 'pending', to: 'completed', legal: false },
  { verb: 'POST /projects/:id/close (from ready_to_build) is REJECTED', from: 'ready_to_build', to: 'completed', legal: false },
  // /reopen — legal endpoints
  { verb: 'POST /projects/:id/reopen (default to=in_production)', from: 'completed', to: 'in_production', legal: true },
  { verb: 'POST /projects/:id/reopen (to=ready_to_ship)', from: 'completed', to: 'ready_to_ship', legal: true },
];

describe('workflow contract: /projects-api/projects/:id/*  ↔ PROJECT_TRANSITIONS', () => {
  it('every (from, to) implied by an API verb has the expected legality', () => {
    for (const { verb, from, to, legal } of IMPLIED_TRANSITIONS) {
      expect(canTransition('project', from, to), verb).toBe(legal);
      if (legal) {
        expect(() => assertTransition('project', from, to)).not.toThrow();
      } else {
        expect(() => assertTransition('project', from, to)).toThrow();
      }
    }
  });

  it('cancelled is terminal (no outbound transitions)', () => {
    expect(PROJECT_TRANSITIONS.cancelled.length).toBe(0);
  });

  it('every non-terminal state may transition to cancelled (decline-like)', () => {
    const nonTerminal: ProjectState[] = [
      'pending',
      'ready_to_build',
      'in_production',
      'ready_to_ship',
    ];
    for (const from of nonTerminal) {
      expect(canTransition('project', from, 'cancelled'), `${from} -> cancelled`).toBe(true);
    }
    // `completed` can NOT directly cancel — it must reopen first.
    expect(canTransition('project', 'completed', 'cancelled')).toBe(false);
  });

  it('matrix covers every state on the prod project_state enum', () => {
    const expected: ProjectState[] = [
      'pending',
      'ready_to_build',
      'in_production',
      'ready_to_ship',
      'completed',
      'cancelled',
    ];
    expect(Object.keys(PROJECT_TRANSITIONS).sort()).toEqual([...expected].sort());
  });
});

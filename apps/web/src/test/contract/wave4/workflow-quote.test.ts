import { describe, it, expect } from 'vitest';

import {
  QUOTE_TRANSITIONS,
  assertTransition,
  canTransition,
  type QuoteState,
} from '@/lib/workflow';

/**
 * Quote workflow state-machine wire-contract parity.
 *
 * Per the orchestrator brief: assert that every API endpoint that calls
 * `assertTransition('quote', ...)` in the BE handlers does so on a `(from, to)`
 * pair that is in `QUOTE_TRANSITIONS`. The byte-mirror parity test in
 * `workflow-parity.test.ts` already pins SPA <-> _shared identity. This
 * test pins the contract between the API verbs and the matrix.
 *
 * From TS1/09-api/00-API-CONTRACT.md §4.1 + PR #38 BE handlers
 * (supabase/functions/quotes-api/handlers/quotes.ts):
 *
 *   POST /quotes/:id/submit             — draft → submitted
 *   POST /quotes/:id/approve            — submitted → approved
 *   POST /quotes/:id/request-revisions  — submitted → revise_requested
 *   POST /quotes/:id/decline            — any non-terminal → cancelled
 *   POST /quotes/:id/convert-to-project — approved → project_pending
 *   POST /quotes/:id/send               — NO transition; activity row only
 *   POST /quotes/:id/accept             — NO transition; activity row only
 *
 * Each (from, to) implied by these endpoint verbs MUST be legal in
 * QUOTE_TRANSITIONS, OR the handler's assertTransition() would 409 every call.
 */

const IMPLIED_TRANSITIONS: ReadonlyArray<{ verb: string; from: QuoteState; to: QuoteState }> = [
  { verb: 'POST /quotes/:id/submit', from: 'draft', to: 'submitted' },
  { verb: 'POST /quotes/:id/approve', from: 'submitted', to: 'approved' },
  { verb: 'POST /quotes/:id/request-revisions', from: 'submitted', to: 'revise_requested' },
  { verb: 'POST /quotes/:id/decline (from draft)', from: 'draft', to: 'cancelled' },
  { verb: 'POST /quotes/:id/decline (from submitted)', from: 'submitted', to: 'cancelled' },
  { verb: 'POST /quotes/:id/decline (from revise_requested)', from: 'revise_requested', to: 'cancelled' },
  { verb: 'POST /quotes/:id/decline (from approved)', from: 'approved', to: 'cancelled' },
  { verb: 'POST /quotes/:id/decline (from project_pending)', from: 'project_pending', to: 'cancelled' },
  {
    verb: 'POST /quotes/:id/convert-to-project',
    from: 'approved',
    to: 'project_pending',
  },
];

describe('workflow contract: /quotes-api/quotes/:id/*  ↔ QUOTE_TRANSITIONS', () => {
  it('every (from, to) implied by an API verb is legal in QUOTE_TRANSITIONS', () => {
    for (const { verb, from, to } of IMPLIED_TRANSITIONS) {
      expect(
        canTransition('quote', from, to),
        `${verb}: ${from} -> ${to} must be legal`,
      ).toBe(true);
      expect(() => assertTransition('quote', from, to)).not.toThrow();
    }
  });

  it('approved -> submitted is NOT legal (forward-only after approve, except /decline)', () => {
    // Sanity guard: the matrix doesn't accidentally allow backtracking from
    // approved to submitted (which would skip /request-revisions semantics).
    expect(canTransition('quote', 'approved', 'submitted')).toBe(false);
  });

  it('cancelled is terminal (no outbound transitions)', () => {
    expect(QUOTE_TRANSITIONS.cancelled.length).toBe(0);
    for (const to of Object.keys(QUOTE_TRANSITIONS) as QuoteState[]) {
      if (to === 'cancelled') continue; // idempotent self
      expect(canTransition('quote', 'cancelled', to)).toBe(false);
    }
  });

  it('matrix covers every state present on the prod quote_state enum', () => {
    // Must align with `quote_state` enum (verified 2026-05-15, migration 0050).
    const expected: QuoteState[] = [
      'draft',
      'submitted',
      'revise_requested',
      'approved',
      'project_pending',
      'cancelled',
    ];
    expect(Object.keys(QUOTE_TRANSITIONS).sort()).toEqual([...expected].sort());
  });
});

import { describe, it, expect } from 'vitest';

import {
  PERIOD_CLOSE_TRANSITIONS,
  assertTransition,
  canTransition,
  type PeriodCloseState,
} from '@/lib/workflow';

/**
 * Period close workflow state-machine wire-contract parity (Wave 8e / Phase 18).
 *
 * PERIOD_CLOSE_TRANSITIONS lifecycle (from `_shared/workflow.ts`):
 *   open       -> in_review
 *   in_review  -> open | closed
 *   closed     -> reopened
 *   reopened   -> in_review
 *
 * Verified against the `period_close_state` pg enum on prod (4 values)
 * post-0062.
 */

const ALL_STATES: ReadonlyArray<PeriodCloseState> = [
  'open',
  'in_review',
  'closed',
  'reopened',
];

describe('workflow contract: PERIOD_CLOSE_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(PERIOD_CLOSE_TRANSITIONS) as Array<
      [PeriodCloseState, readonly PeriodCloseState[]]
    >) {
      for (const to of toList) {
        expect(
          canTransition('period_close', from, to),
          `legal period_close: ${from} -> ${to}`,
        ).toBe(true);
        expect(() => assertTransition('period_close', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(PERIOD_CLOSE_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue;
        if (legal.has(to)) continue;
        expect(
          canTransition('period_close', from, to),
          `illegal period_close: ${from} -> ${to}`,
        ).toBe(false);
        expect(() => assertTransition('period_close', from, to)).toThrow();
      }
    }
  });

  it('from === to is idempotent for every state', () => {
    for (const s of ALL_STATES) {
      expect(canTransition('period_close', s, s), `idempotent ${s} -> ${s}`).toBe(true);
      expect(() => assertTransition('period_close', s, s)).not.toThrow();
    }
  });

  it('no terminal state — every state has at least one outbound edge', () => {
    // Reopen path keeps the machine live; closed -> reopened is the only
    // exit from closed but it exists. The audit chain has no dead-ends.
    for (const s of ALL_STATES) {
      expect(PERIOD_CLOSE_TRANSITIONS[s].length, `${s} has zero outbound edges`).toBeGreaterThan(0);
    }
  });

  it('canonical forward lifecycle is legal step-by-step', () => {
    expect(canTransition('period_close', 'open', 'in_review')).toBe(true);
    expect(canTransition('period_close', 'in_review', 'closed')).toBe(true);
    expect(canTransition('period_close', 'closed', 'reopened')).toBe(true);
    expect(canTransition('period_close', 'reopened', 'in_review')).toBe(true);
  });

  it('the audit-required reopen path goes through in_review (no direct open from closed)', () => {
    // closed → open is illegal; the only exit from closed is reopened,
    // which then flows back through in_review. This is the audit invariant.
    expect(canTransition('period_close', 'closed', 'open')).toBe(false);
    expect(canTransition('period_close', 'closed', 'in_review')).toBe(false);
    expect(canTransition('period_close', 'closed', 'reopened')).toBe(true);
    expect(canTransition('period_close', 'reopened', 'open')).toBe(false);
    expect(canTransition('period_close', 'reopened', 'closed')).toBe(false);
    expect(canTransition('period_close', 'reopened', 'in_review')).toBe(true);
  });
});

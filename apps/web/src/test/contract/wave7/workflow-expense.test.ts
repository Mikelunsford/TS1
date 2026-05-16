import { describe, it, expect } from 'vitest';

import {
  EXPENSE_TRANSITIONS,
  assertTransition,
  canTransition,
  type ExpenseState,
} from '@/lib/workflow';

/**
 * Expense workflow state-machine wire-contract parity (Wave 7 / Phase 11).
 * Mirrors `wave5/workflow-invoice.test.ts`.
 *
 * EXPENSE_TRANSITIONS lifecycle (from `_shared/workflow.ts`):
 *   draft       -> submitted
 *   submitted   -> approved | rejected
 *   rejected    -> submitted          (resubmission path)
 *   approved    -> reimbursed | paid
 *   reimbursed  -> [] (terminal)
 *   paid        -> [] (terminal)
 *
 * The matrix has 6 values with NO `cancelled` — rejected expenses get
 * re-edited and re-submitted. Verified against prod CHECK on `expenses.status`
 * 2026-05-16, schema_migrations=0058.
 */

const ALL_STATES: ReadonlyArray<ExpenseState> = [
  'draft',
  'submitted',
  'approved',
  'rejected',
  'reimbursed',
  'paid',
];

describe('workflow contract: EXPENSE_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(EXPENSE_TRANSITIONS) as Array<
      [ExpenseState, readonly ExpenseState[]]
    >) {
      for (const to of toList) {
        expect(canTransition('expense', from, to), `legal expense: ${from} -> ${to}`).toBe(
          true,
        );
        expect(() => assertTransition('expense', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(EXPENSE_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue;
        if (legal.has(to)) continue;
        expect(
          canTransition('expense', from, to),
          `illegal expense: ${from} -> ${to}`,
        ).toBe(false);
        expect(() => assertTransition('expense', from, to)).toThrow();
      }
    }
  });

  it('from === to is idempotent for every state', () => {
    for (const s of ALL_STATES) {
      expect(canTransition('expense', s, s), `idempotent ${s} -> ${s}`).toBe(true);
      expect(() => assertTransition('expense', s, s)).not.toThrow();
    }
  });

  it('reimbursed and paid are terminal (no outbound transitions)', () => {
    expect(EXPENSE_TRANSITIONS.reimbursed.length).toBe(0);
    expect(EXPENSE_TRANSITIONS.paid.length).toBe(0);
  });

  it('canonical forward lifecycle is legal step-by-step', () => {
    // draft -> submitted -> approved -> (reimbursed | paid)
    expect(canTransition('expense', 'draft', 'submitted')).toBe(true);
    expect(canTransition('expense', 'submitted', 'approved')).toBe(true);
    expect(canTransition('expense', 'approved', 'reimbursed')).toBe(true);
    expect(canTransition('expense', 'approved', 'paid')).toBe(true);
  });

  it('rejected -> submitted is legal (resubmission path)', () => {
    // The constitutional rule: a rejected expense can be re-edited and
    // re-submitted. The matrix has no `cancelled` state because the
    // resubmission loop replaces it.
    expect(canTransition('expense', 'submitted', 'rejected')).toBe(true);
    expect(canTransition('expense', 'rejected', 'submitted')).toBe(true);
  });

  it('forbids draft -> approved (no skipping submitted)', () => {
    expect(canTransition('expense', 'draft', 'approved')).toBe(false);
    expect(canTransition('expense', 'draft', 'rejected')).toBe(false);
    expect(canTransition('expense', 'draft', 'paid')).toBe(false);
    expect(canTransition('expense', 'draft', 'reimbursed')).toBe(false);
  });

  it('forbids submitted -> paid/reimbursed (must approve first)', () => {
    expect(canTransition('expense', 'submitted', 'paid')).toBe(false);
    expect(canTransition('expense', 'submitted', 'reimbursed')).toBe(false);
  });

  it('forbids rejected -> approved/paid (must resubmit then approve)', () => {
    expect(canTransition('expense', 'rejected', 'approved')).toBe(false);
    expect(canTransition('expense', 'rejected', 'paid')).toBe(false);
    expect(canTransition('expense', 'rejected', 'reimbursed')).toBe(false);
  });

  it('expense matrix has NO cancelled state (rejected loops back instead)', () => {
    // Constitutional rule: expenses cannot be cancelled. Pins against the
    // dispatch-default "always 7-state with cancelled" assumption.
    expect(Object.keys(EXPENSE_TRANSITIONS)).not.toContain('cancelled');
    expect(canTransition('expense', 'draft', 'cancelled')).toBe(false);
    expect(canTransition('expense', 'submitted', 'cancelled')).toBe(false);
    expect(canTransition('expense', 'approved', 'cancelled')).toBe(false);
  });

  it('matrix covers every state on the prod expenses.status CHECK (6 values)', () => {
    expect(Object.keys(EXPENSE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
    expect(Object.keys(EXPENSE_TRANSITIONS).length).toBe(6);
  });
});

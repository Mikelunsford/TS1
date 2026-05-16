import { describe, it, expect } from 'vitest';

import {
  CREDIT_NOTE_TRANSITIONS,
  assertTransition,
  canTransition,
  type CreditNoteState,
} from '@/lib/workflow';

/**
 * Credit-note workflow state-machine wire-contract parity (Wave 5 / Phase 8).
 *
 * CREDIT_NOTE_TRANSITIONS lifecycle:
 *   draft   -> issued | voided
 *   issued  -> applied | voided
 *   applied -> voided
 *   voided  -> [] (terminal)
 *
 * Idempotent: `from === to` is always allowed.
 */

const ALL_STATES: ReadonlyArray<CreditNoteState> = ['draft', 'issued', 'applied', 'voided'];

describe('workflow contract: CREDIT_NOTE_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(CREDIT_NOTE_TRANSITIONS) as Array<
      [CreditNoteState, readonly CreditNoteState[]]
    >) {
      for (const to of toList) {
        expect(canTransition('credit_note', from, to), `legal: ${from} -> ${to}`).toBe(true);
        expect(() => assertTransition('credit_note', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(CREDIT_NOTE_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue;
        if (legal.has(to)) continue;
        expect(canTransition('credit_note', from, to), `illegal: ${from} -> ${to}`).toBe(false);
        expect(() => assertTransition('credit_note', from, to)).toThrow();
      }
    }
  });

  it('voided is terminal; from === to is idempotent for every state', () => {
    expect(CREDIT_NOTE_TRANSITIONS.voided.length).toBe(0);
    for (const s of ALL_STATES) {
      expect(canTransition('credit_note', s, s)).toBe(true);
    }
  });

  it('matrix covers the 4 prod credit_notes.status CHECK values', () => {
    expect(Object.keys(CREDIT_NOTE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
    // draft cannot skip to applied; must go through issued first.
    expect(canTransition('credit_note', 'draft', 'applied')).toBe(false);
    expect(canTransition('credit_note', 'draft', 'issued')).toBe(true);
    // Every non-terminal state may void.
    for (const from of ['draft', 'issued', 'applied'] as const) {
      expect(canTransition('credit_note', from, 'voided'), `${from} -> voided`).toBe(true);
    }
  });
});

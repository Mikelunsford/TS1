import { describe, it, expect } from 'vitest';

import * as spa from '@/lib/workflow';
import * as shared from '@shared/workflow';

/**
 * Workflow byte-mirror parity. `apps/web/src/lib/workflow.ts` and
 * `supabase/functions/_shared/workflow.ts` must export the same matrices
 * and helper behaviour. See TS1/03-workspace/journal/2026-05-15-wave-4-
 * preflight-handoff.md F-Wave4-11.
 */

describe('workflow parity (apps/web/src/lib/workflow.ts ↔ supabase/functions/_shared/workflow.ts)', () => {
  it('exports the same set of names', () => {
    expect(Object.keys(shared).sort()).toEqual(Object.keys(spa).sort());
  });

  it('QUOTE_TRANSITIONS is identical', () => {
    expect(shared.QUOTE_TRANSITIONS).toEqual(spa.QUOTE_TRANSITIONS);
  });

  it('PROJECT_TRANSITIONS is identical', () => {
    expect(shared.PROJECT_TRANSITIONS).toEqual(spa.PROJECT_TRANSITIONS);
  });

  it('PHASE_TRANSITIONS is identical', () => {
    expect(shared.PHASE_TRANSITIONS).toEqual(spa.PHASE_TRANSITIONS);
  });

  it('INVOICE_TRANSITIONS is identical', () => {
    expect(shared.INVOICE_TRANSITIONS).toEqual(spa.INVOICE_TRANSITIONS);
  });

  it('CREDIT_NOTE_TRANSITIONS is identical', () => {
    expect(shared.CREDIT_NOTE_TRANSITIONS).toEqual(spa.CREDIT_NOTE_TRANSITIONS);
  });

  it('canTransition agrees on every (machine, from, to) tuple in the union', () => {
    const matrices = [
      ['quote', spa.QUOTE_TRANSITIONS],
      ['project', spa.PROJECT_TRANSITIONS],
      ['phase', spa.PHASE_TRANSITIONS],
      ['invoice', spa.INVOICE_TRANSITIONS],
      ['credit_note', spa.CREDIT_NOTE_TRANSITIONS],
    ] as const;
    for (const [machine, matrix] of matrices) {
      const states = Object.keys(matrix);
      for (const from of states) {
        for (const to of states) {
          expect(
            shared.canTransition(machine, from, to),
            `${machine}: ${from} -> ${to}`,
          ).toBe(spa.canTransition(machine, from, to));
        }
      }
    }
  });

  it('assertTransition throws for illegal transitions and is silent on legal ones', () => {
    expect(() => spa.assertTransition('quote', 'draft', 'approved')).toThrow();
    expect(() => shared.assertTransition('quote', 'draft', 'approved')).toThrow();
    expect(() => spa.assertTransition('quote', 'draft', 'submitted')).not.toThrow();
    expect(() => shared.assertTransition('quote', 'draft', 'submitted')).not.toThrow();
    // Idempotent: same -> same is allowed everywhere
    expect(() => spa.assertTransition('quote', 'approved', 'approved')).not.toThrow();
    expect(() => shared.assertTransition('phase', 'cancelled', 'cancelled')).not.toThrow();
  });
});

import { describe, it, expect } from 'vitest';

import {
  INVOICE_TRANSITIONS,
  assertTransition,
  canTransition,
  type InvoiceState,
} from '@/lib/workflow';

/**
 * Invoice workflow state-machine wire-contract parity (Wave 5 / Phase 7).
 *
 * INVOICE_TRANSITIONS lifecycle (from `_shared/workflow.ts`):
 *   draft           -> pending | cancelled
 *   pending         -> sent | cancelled | on_hold
 *   sent            -> partially_paid | paid | overdue | cancelled | on_hold
 *   partially_paid  -> paid | overdue | refunded
 *   paid            -> refunded
 *   overdue         -> partially_paid | paid | cancelled
 *   on_hold         -> pending | sent | cancelled
 *   refunded        -> [] (terminal)
 *   cancelled       -> [] (terminal)
 *
 * Per `apps/web/src/lib/workflow.ts`, `canTransition` treats `from === to`
 * as legal (idempotent re-stamp).
 */

const ALL_STATES: ReadonlyArray<InvoiceState> = [
  'draft',
  'pending',
  'sent',
  'partially_paid',
  'paid',
  'overdue',
  'refunded',
  'cancelled',
  'on_hold',
];

describe('workflow contract: INVOICE_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(INVOICE_TRANSITIONS) as Array<
      [InvoiceState, readonly InvoiceState[]]
    >) {
      for (const to of toList) {
        expect(
          canTransition('invoice', from, to),
          `legal invoice: ${from} -> ${to}`,
        ).toBe(true);
        expect(() => assertTransition('invoice', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(INVOICE_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue; // idempotent self handled separately
        if (legal.has(to)) continue; // legal handled above
        expect(
          canTransition('invoice', from, to),
          `illegal invoice: ${from} -> ${to}`,
        ).toBe(false);
        expect(() => assertTransition('invoice', from, to)).toThrow();
      }
    }
  });

  it('from === to is idempotent for every state (canTransition true, assertTransition silent)', () => {
    for (const s of ALL_STATES) {
      expect(canTransition('invoice', s, s), `idempotent ${s} -> ${s}`).toBe(true);
      expect(() => assertTransition('invoice', s, s)).not.toThrow();
    }
  });

  it('refunded and cancelled are terminal (no outbound transitions)', () => {
    expect(INVOICE_TRANSITIONS.refunded.length).toBe(0);
    expect(INVOICE_TRANSITIONS.cancelled.length).toBe(0);
  });

  it('draft -> pending is legal, draft -> paid is illegal (no skipping)', () => {
    expect(canTransition('invoice', 'draft', 'pending')).toBe(true);
    expect(canTransition('invoice', 'draft', 'paid')).toBe(false);
    expect(canTransition('invoice', 'draft', 'sent')).toBe(false);
  });

  it('pending -> sent is legal; sent -> paid/partially_paid are legal', () => {
    expect(canTransition('invoice', 'pending', 'sent')).toBe(true);
    expect(canTransition('invoice', 'sent', 'paid')).toBe(true);
    expect(canTransition('invoice', 'sent', 'partially_paid')).toBe(true);
  });

  it('on_hold can return to pending or sent (release path)', () => {
    expect(canTransition('invoice', 'on_hold', 'pending')).toBe(true);
    expect(canTransition('invoice', 'on_hold', 'sent')).toBe(true);
    // But on_hold -> paid is illegal (must release first).
    expect(canTransition('invoice', 'on_hold', 'paid')).toBe(false);
  });

  it('paid invoices cannot cancel directly (must refund)', () => {
    // Paid only goes to refunded. This is the constitutional rule that the
    // e2e smoke pins in step 13.
    expect(canTransition('invoice', 'paid', 'cancelled')).toBe(false);
    expect(canTransition('invoice', 'paid', 'refunded')).toBe(true);
  });

  it('matrix covers every state on the prod invoices.status CHECK', () => {
    expect(Object.keys(INVOICE_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it('every non-terminal pre-paid state may transition to cancelled', () => {
    // draft / pending / sent / overdue / on_hold may cancel. partially_paid
    // and paid may NOT (they go through refunded).
    const cancellable: InvoiceState[] = ['draft', 'pending', 'sent', 'overdue', 'on_hold'];
    for (const from of cancellable) {
      expect(canTransition('invoice', from, 'cancelled'), `${from} -> cancelled`).toBe(true);
    }
    expect(canTransition('invoice', 'partially_paid', 'cancelled')).toBe(false);
    expect(canTransition('invoice', 'paid', 'cancelled')).toBe(false);
  });
});

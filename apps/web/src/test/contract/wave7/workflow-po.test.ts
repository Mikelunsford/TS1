import { describe, it, expect } from 'vitest';

import {
  PURCHASE_ORDER_TRANSITIONS,
  assertTransition,
  canTransition,
  type PurchaseOrderState,
} from '@/lib/workflow';

/**
 * Purchase-order workflow state-machine wire-contract parity (Wave 7 /
 * Phase 10). Mirrors `wave5/workflow-invoice.test.ts`.
 *
 * PURCHASE_ORDER_TRANSITIONS lifecycle (from `_shared/workflow.ts`):
 *   draft            -> submitted | cancelled
 *   submitted        -> approved | draft | cancelled
 *   approved         -> partial_received | received | cancelled
 *   partial_received -> received | cancelled
 *   received         -> closed | cancelled
 *   closed           -> [] (terminal)
 *   cancelled        -> [] (terminal)
 *
 * Spelling is `partial_received` (one r), NOT `partially_received` — verified
 * against prod CHECK on `purchase_orders.status` 2026-05-16,
 * schema_migrations=0058.
 *
 * Per `apps/web/src/lib/workflow.ts`, `canTransition` treats `from === to`
 * as legal (idempotent re-stamp).
 */

const ALL_STATES: ReadonlyArray<PurchaseOrderState> = [
  'draft',
  'submitted',
  'approved',
  'partial_received',
  'received',
  'cancelled',
  'closed',
];

describe('workflow contract: PURCHASE_ORDER_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(PURCHASE_ORDER_TRANSITIONS) as Array<
      [PurchaseOrderState, readonly PurchaseOrderState[]]
    >) {
      for (const to of toList) {
        expect(
          canTransition('purchase_order', from, to),
          `legal purchase_order: ${from} -> ${to}`,
        ).toBe(true);
        expect(() => assertTransition('purchase_order', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(PURCHASE_ORDER_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue;
        if (legal.has(to)) continue;
        expect(
          canTransition('purchase_order', from, to),
          `illegal purchase_order: ${from} -> ${to}`,
        ).toBe(false);
        expect(() => assertTransition('purchase_order', from, to)).toThrow();
      }
    }
  });

  it('from === to is idempotent for every state', () => {
    for (const s of ALL_STATES) {
      expect(canTransition('purchase_order', s, s), `idempotent ${s} -> ${s}`).toBe(true);
      expect(() => assertTransition('purchase_order', s, s)).not.toThrow();
    }
  });

  it('closed and cancelled are terminal (no outbound transitions)', () => {
    expect(PURCHASE_ORDER_TRANSITIONS.closed.length).toBe(0);
    expect(PURCHASE_ORDER_TRANSITIONS.cancelled.length).toBe(0);
  });

  it('canonical forward lifecycle is legal step-by-step', () => {
    // draft -> submitted -> approved -> partial_received -> received -> closed
    expect(canTransition('purchase_order', 'draft', 'submitted')).toBe(true);
    expect(canTransition('purchase_order', 'submitted', 'approved')).toBe(true);
    expect(canTransition('purchase_order', 'approved', 'partial_received')).toBe(true);
    expect(canTransition('purchase_order', 'partial_received', 'received')).toBe(true);
    expect(canTransition('purchase_order', 'received', 'closed')).toBe(true);
  });

  it('forbids draft -> approved (no skipping submitted)', () => {
    expect(canTransition('purchase_order', 'draft', 'approved')).toBe(false);
    expect(canTransition('purchase_order', 'draft', 'received')).toBe(false);
    expect(canTransition('purchase_order', 'draft', 'closed')).toBe(false);
  });

  it('forbids submitted -> received (must approve first)', () => {
    expect(canTransition('purchase_order', 'submitted', 'received')).toBe(false);
    expect(canTransition('purchase_order', 'submitted', 'partial_received')).toBe(false);
    expect(canTransition('purchase_order', 'submitted', 'closed')).toBe(false);
  });

  it('forbids approved -> closed (must receive first)', () => {
    expect(canTransition('purchase_order', 'approved', 'closed')).toBe(false);
  });

  it('approved can skip directly to received (full receipt in one go)', () => {
    expect(canTransition('purchase_order', 'approved', 'received')).toBe(true);
  });

  it('submitted can step back to draft for revision before approval', () => {
    expect(canTransition('purchase_order', 'submitted', 'draft')).toBe(true);
    // But the matrix forbids approved -> draft (no back-step after approval).
    expect(canTransition('purchase_order', 'approved', 'draft')).toBe(false);
  });

  it('cancelled reachable from every non-terminal state', () => {
    const cancellable: PurchaseOrderState[] = [
      'draft',
      'submitted',
      'approved',
      'partial_received',
      'received',
    ];
    for (const from of cancellable) {
      expect(canTransition('purchase_order', from, 'cancelled'), `${from} -> cancelled`).toBe(
        true,
      );
    }
    // Terminal states cannot transition further (incl. to cancelled).
    expect(canTransition('purchase_order', 'cancelled', 'cancelled')).toBe(true); // idempotent
    expect(canTransition('purchase_order', 'closed', 'cancelled')).toBe(false);
  });

  it('matrix covers every state on the prod purchase_orders.status CHECK', () => {
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });

  it('uses the prod spelling "partial_received" (not "partially_received")', () => {
    // Pins the constitutional spelling. The Wave 7 dispatch text used
    // `partially_received`; the prod CHECK is `partial_received` (one r).
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS)).toContain('partial_received');
    expect(Object.keys(PURCHASE_ORDER_TRANSITIONS)).not.toContain('partially_received');
  });
});

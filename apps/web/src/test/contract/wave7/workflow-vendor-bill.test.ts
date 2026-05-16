import { describe, it, expect } from 'vitest';

import {
  VENDOR_BILL_TRANSITIONS,
  assertTransition,
  canTransition,
  type VendorBillState,
} from '@/lib/workflow';

/**
 * Vendor-bill workflow state-machine wire-contract parity (Wave 7 /
 * Phase 10). Mirrors `wave5/workflow-invoice.test.ts`.
 *
 * VENDOR_BILL_TRANSITIONS lifecycle (from `_shared/workflow.ts`):
 *   draft           -> pending | cancelled
 *   pending         -> approved | cancelled
 *   approved        -> partially_paid | paid | overdue | cancelled
 *   partially_paid  -> paid | overdue | cancelled
 *   overdue         -> partially_paid | paid | cancelled
 *   paid            -> [] (terminal)
 *   cancelled       -> [] (terminal)
 *
 * `overdue` is a 7th state set by handler / background when due_date < today
 * and the bill is not yet paid. It is reachable from approved / partially_paid.
 */

const ALL_STATES: ReadonlyArray<VendorBillState> = [
  'draft',
  'pending',
  'approved',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
];

describe('workflow contract: VENDOR_BILL_TRANSITIONS', () => {
  it('every legal (from -> to) returns canTransition=true', () => {
    for (const [from, toList] of Object.entries(VENDOR_BILL_TRANSITIONS) as Array<
      [VendorBillState, readonly VendorBillState[]]
    >) {
      for (const to of toList) {
        expect(
          canTransition('vendor_bill', from, to),
          `legal vendor_bill: ${from} -> ${to}`,
        ).toBe(true);
        expect(() => assertTransition('vendor_bill', from, to)).not.toThrow();
      }
    }
  });

  it('every illegal (from -> to, with from !== to) returns canTransition=false', () => {
    for (const from of ALL_STATES) {
      const legal = new Set<string>(VENDOR_BILL_TRANSITIONS[from]);
      for (const to of ALL_STATES) {
        if (from === to) continue;
        if (legal.has(to)) continue;
        expect(
          canTransition('vendor_bill', from, to),
          `illegal vendor_bill: ${from} -> ${to}`,
        ).toBe(false);
        expect(() => assertTransition('vendor_bill', from, to)).toThrow();
      }
    }
  });

  it('from === to is idempotent for every state', () => {
    for (const s of ALL_STATES) {
      expect(canTransition('vendor_bill', s, s), `idempotent ${s} -> ${s}`).toBe(true);
      expect(() => assertTransition('vendor_bill', s, s)).not.toThrow();
    }
  });

  it('paid and cancelled are terminal (no outbound transitions)', () => {
    expect(VENDOR_BILL_TRANSITIONS.paid.length).toBe(0);
    expect(VENDOR_BILL_TRANSITIONS.cancelled.length).toBe(0);
  });

  it('canonical forward lifecycle is legal step-by-step', () => {
    // draft -> pending -> approved -> partially_paid -> paid
    expect(canTransition('vendor_bill', 'draft', 'pending')).toBe(true);
    expect(canTransition('vendor_bill', 'pending', 'approved')).toBe(true);
    expect(canTransition('vendor_bill', 'approved', 'partially_paid')).toBe(true);
    expect(canTransition('vendor_bill', 'partially_paid', 'paid')).toBe(true);
    // Approved -> paid (one-shot full payment) is also legal.
    expect(canTransition('vendor_bill', 'approved', 'paid')).toBe(true);
  });

  it('forbids draft -> approved (no skipping pending)', () => {
    expect(canTransition('vendor_bill', 'draft', 'approved')).toBe(false);
    expect(canTransition('vendor_bill', 'draft', 'paid')).toBe(false);
  });

  it('forbids pending -> paid (must approve first)', () => {
    expect(canTransition('vendor_bill', 'pending', 'paid')).toBe(false);
    expect(canTransition('vendor_bill', 'pending', 'partially_paid')).toBe(false);
  });

  it('overdue reachable from approved and partially_paid (background flip)', () => {
    expect(canTransition('vendor_bill', 'approved', 'overdue')).toBe(true);
    expect(canTransition('vendor_bill', 'partially_paid', 'overdue')).toBe(true);
    // Overdue can resolve to partially_paid/paid as payments arrive.
    expect(canTransition('vendor_bill', 'overdue', 'partially_paid')).toBe(true);
    expect(canTransition('vendor_bill', 'overdue', 'paid')).toBe(true);
    expect(canTransition('vendor_bill', 'overdue', 'cancelled')).toBe(true);
  });

  it('paid bills cannot transition further (terminal)', () => {
    expect(canTransition('vendor_bill', 'paid', 'overdue')).toBe(false);
    expect(canTransition('vendor_bill', 'paid', 'cancelled')).toBe(false);
    expect(canTransition('vendor_bill', 'paid', 'partially_paid')).toBe(false);
  });

  it('cancelled reachable from every non-terminal state', () => {
    const cancellable: VendorBillState[] = [
      'draft',
      'pending',
      'approved',
      'partially_paid',
      'overdue',
    ];
    for (const from of cancellable) {
      expect(canTransition('vendor_bill', from, 'cancelled'), `${from} -> cancelled`).toBe(true);
    }
    expect(canTransition('vendor_bill', 'paid', 'cancelled')).toBe(false);
  });

  it('matrix covers every state on the prod vendor_bills.status CHECK', () => {
    expect(Object.keys(VENDOR_BILL_TRANSITIONS).sort()).toEqual([...ALL_STATES].sort());
  });
});

import { describe, it, expect } from 'vitest';

/**
 * Phase 14 — Numbering unification.
 *
 * Migration 0064 lays an advisory-xact lock keyed on
 * `hashtext(p_org_id::text || ':' || p_doc_type)` over the existing
 * `next_doc_number()` RPC from 0034. This contract test pins the
 * invariants that 100 parallel allocations against a single (org, kind)
 * must yield 100 distinct, monotonically-increasing values.
 *
 * The live race-detection runs against a Supabase instance in the
 * migrate.yml + deploy-functions.yml integration job. Here we exercise
 * the *shape* invariants of the allocator in a deterministic in-memory
 * model so that:
 *
 *  1. Drift to the format string (`prefix + year + '-' + lpad(n, pad)`)
 *     fails CI.
 *  2. Drift to the doc-kind set (12 canonical kinds) fails CI.
 *  3. Concurrency-invariant: 100 sequential ticks return 100 unique
 *     values, monotonically increasing by 1. (Real concurrency is
 *     exercised by the DB advisory lock — see migration 0064.)
 */

import { DOC_KINDS, formatNumber, type DocKind } from '@/lib/numbering';

const KINDS: readonly DocKind[] = [
  'quote',
  'invoice',
  'credit_note',
  'payment',
  'project',
  'purchase_order',
  'vendor_bill',
  'expense',
  'journal_entry',
  'receiving_order',
  'production_run',
  'shipment',
];

describe('Phase 14 / 0064 — DocKind canon', () => {
  it('exports exactly the 12 canonical kinds', () => {
    expect([...DOC_KINDS].sort()).toEqual([...KINDS].sort());
  });
});

describe('Phase 14 / 0064 — 100 parallel allocations produce 100 unique values (in-memory model)', () => {
  it('returns 100 distinct numbers when 100 callers race for the same (org, kind)', async () => {
    let counter = 0;
    const allocate = (): Promise<string> =>
      // Simulate the advisory-locked SECURITY DEFINER body.
      // Each "transaction" reads-increments-writes atomically.
      Promise.resolve().then(() => {
        const next = ++counter;
        return formatNumber('INV-', 2026, next, 5);
      });

    const results = await Promise.all(Array.from({ length: 100 }, () => allocate()));

    expect(results).toHaveLength(100);
    expect(new Set(results).size).toBe(100);
    expect(results[0]).toBe('INV-2026-00001');
    expect(results[99]).toBe('INV-2026-00100');
  });

  it('values are monotonically increasing when serialised', async () => {
    let counter = 0;
    const out: string[] = [];
    for (let i = 0; i < 100; i++) {
      const next = ++counter;
      out.push(formatNumber('Q-', 2026, next, 5));
    }
    for (let i = 1; i < out.length; i++) {
      const cur = out[i]!;
      const prev = out[i - 1]!;
      expect(cur > prev).toBe(true);
    }
  });
});

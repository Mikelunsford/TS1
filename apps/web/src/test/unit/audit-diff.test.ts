/**
 * Unit tests for computeDiff (Phase 17 — Wave 10 Session 2 / B2).
 *
 * computeDiff is the diff helper used by writeAudit() on the BE side. The
 * same shape is exercised from the SPA when rendering <AuditTimeline>'s
 * diff body. We test the pure function shape here (no DB needed).
 *
 * The actual function lives at supabase/functions/_shared/audit.ts. We
 * re-declare it locally to avoid pulling in Deno-only imports.
 */

import { describe, expect, it } from 'vitest';

function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!before && !after) return null;
  if (!before) return { after };
  if (!after) return { before };
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed[k] = { before: a, after: b };
    }
  }
  return { changed };
}

describe('computeDiff', () => {
  it('returns null when both inputs are nullish', () => {
    expect(computeDiff(null, null)).toBeNull();
    expect(computeDiff(undefined, undefined)).toBeNull();
  });

  it('returns {after} when before is missing (create case)', () => {
    expect(computeDiff(null, { id: '1', name: 'Acme' })).toEqual({
      after: { id: '1', name: 'Acme' },
    });
  });

  it('returns {before} when after is missing (delete case)', () => {
    expect(computeDiff({ id: '1' }, null)).toEqual({ before: { id: '1' } });
  });

  it('detects changed fields and ignores unchanged ones', () => {
    const diff = computeDiff(
      { id: '1', name: 'Old', email: 'a@x.io' },
      { id: '1', name: 'New', email: 'a@x.io' },
    );
    expect(diff).toEqual({
      changed: { name: { before: 'Old', after: 'New' } },
    });
  });

  it('detects added fields', () => {
    const diff = computeDiff({ id: '1' }, { id: '1', phone: '555' });
    expect(diff).toEqual({
      changed: { phone: { before: undefined, after: '555' } },
    });
  });

  it('handles nested object differences via JSON-equality', () => {
    const diff = computeDiff(
      { id: '1', address: { city: 'NYC' } },
      { id: '1', address: { city: 'SF' } },
    );
    expect(diff).toEqual({
      changed: {
        address: {
          before: { city: 'NYC' },
          after: { city: 'SF' },
        },
      },
    });
  });

  it('returns empty `changed` when objects are deeply equal', () => {
    const diff = computeDiff(
      { id: '1', name: 'Same' },
      { id: '1', name: 'Same' },
    );
    expect(diff).toEqual({ changed: {} });
  });
});

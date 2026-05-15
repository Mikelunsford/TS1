import { describe, it, expect } from 'vitest';

import * as spa from '@/lib/types';
import * as shared from '@shared/types';

/**
 * Zod canon parity test. The two type files must export the same set of
 * Zod schemas with identical shape. We compare by:
 *
 *  1. Same set of exported names.
 *  2. For each Zod schema, identical JSON-stringified `_def` shape.
 *
 * If a schema is added to one file but not the other, this test fails.
 * If a schema is changed in one file but not the other, this test fails.
 *
 * Drift is a release-blocker. See TS1/03-workspace/00-SHARED-CONTEXT.md.
 */

function isZodLike(v: unknown): v is { _def: unknown } {
  return typeof v === 'object' && v !== null && '_def' in v;
}

describe('Zod canon parity (apps/web/src/lib/types.ts ↔ supabase/functions/_shared/types.ts)', () => {
  it('exports the same set of names', () => {
    const spaNames = Object.keys(spa).sort();
    const sharedNames = Object.keys(shared).sort();
    expect(sharedNames).toEqual(spaNames);
  });

  it('each Zod schema has an identical _def shape', () => {
    const spaEntries = Object.entries(spa);
    for (const [name, value] of spaEntries) {
      if (!isZodLike(value)) continue;
      const otherValue = (shared as Record<string, unknown>)[name];
      expect(isZodLike(otherValue), `${name} is missing or not a Zod schema in _shared`).toBe(true);
      const spaDef = JSON.stringify(value._def, replacer);
      const sharedDef = JSON.stringify((otherValue as { _def: unknown })._def, replacer);
      expect(sharedDef, `Drift detected on ${name}`).toEqual(spaDef);
    }
  });
});

// Zod _def contains functions (typeName, checks). Stringify with a stable
// replacer that elides function bodies but keeps names + shape.
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return `[fn ${value.name || 'anon'}]`;
  return value;
}

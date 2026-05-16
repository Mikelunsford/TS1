/**
 * Phase 15 — requireFlag middleware contract test.
 *
 * The BE middleware lives at supabase/functions/_shared/requireFlag.ts.
 * It throws ApiError('FEATURE_DISABLED', 403, { flag }) when the flag is
 * off. This test mirrors the contract inline (Deno-runtime code can't
 * import directly into Node test runner — same pattern as
 * feature-flags-cache.test.ts).
 */
import { describe, expect, it } from 'vitest';

class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function requireFlag(
  isEnabled: (orgId: string, key: string) => Promise<boolean>,
  orgId: string,
  flagKey: string,
): Promise<void> {
  const enabled = await isEnabled(orgId, flagKey);
  if (!enabled) {
    throw new ApiError(
      'FEATURE_DISABLED',
      `Feature '${flagKey}' is not enabled for this workspace.`,
      403,
      { flag: flagKey },
    );
  }
}

describe('requireFlag middleware (Phase 15)', () => {
  it('passes through when the flag is enabled', async () => {
    const reader = async () => true;
    await expect(requireFlag(reader, 'org-1', 'inventory.enabled')).resolves.toBeUndefined();
  });

  it('throws FEATURE_DISABLED 403 with details.flag when off', async () => {
    const reader = async () => false;
    await expect(requireFlag(reader, 'org-1', 'finance.expenses')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
      status: 403,
      details: { flag: 'finance.expenses' },
    });
  });

  it('fails closed when the flag row is absent (false from reader)', async () => {
    const reader = async () => false;
    await expect(requireFlag(reader, 'org-1', 'no.such.flag')).rejects.toThrow();
  });
});

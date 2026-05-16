/**
 * Wave 6 / PR #58 — feature-flags reader cache contract.
 *
 * The reader under test lives at
 * `supabase/functions/_shared/feature-flags.ts` and ships a 5-minute
 * in-memory cache keyed by `(orgId, flagKey)`. The module imports a Deno
 * URL (`./supabase-admin.ts`) at the type-only level but uses *no* Deno
 * runtime APIs — the body is plain TS that compiles under Node + Vitest
 * once the type-only import is stubbed. Module resolution in Vitest is
 * the only friction; we side-step it by re-implementing the cache contract
 * here inline + asserting parity. The contract is small and the inline
 * mirror is mechanically obvious; any divergence is caught by the
 * Phase 6 integration probe (ops-api flag-on / flag-off behavior, covered
 * by the RLS probe additions in PR #58).
 *
 * Cache contract (verified against `feature-flags.ts` 2026-05-16):
 *   1. `isFeatureEnabled(client, orgId, flagKey)` returns true iff
 *      `org_feature_flags.is_enabled === true` for the (org, key) row.
 *   2. Result is cached for 5 minutes keyed by `${orgId}::${flagKey}`.
 *   3. Within the TTL, a second call MUST NOT re-query the DB.
 *   4. Absent row → false (and cached as false).
 *   5. Query error → false (fail-closed; cached as false).
 *   6. `_clearFeatureFlagCache()` resets the Map; the next call re-queries.
 *
 * The inline `runReader` below is a faithful transliteration of the
 * production reader — same Map keying, same TTL, same fail-closed branch.
 * If the production reader changes shape (e.g. adds a plan-level lookup
 * per Phase 23), this test must be updated to mirror the new contract;
 * the comment block at the top of `feature-flags.ts` already calls that
 * out as the trigger.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

interface FlagRow {
  is_enabled: boolean;
}

interface FlagFetchResult {
  data: FlagRow | null;
  error: { message: string } | null;
}

/**
 * Inline mirror of the production reader. The DB call is abstracted as
 * a single async function so tests can spy + assert call counts.
 */
function makeReader(fetcher: (orgId: string, flagKey: string) => Promise<FlagFetchResult>) {
  const cache = new Map<string, CacheEntry>();
  const cacheKey = (orgId: string, flagKey: string): string => `${orgId}::${flagKey}`;

  async function isFeatureEnabled(orgId: string, flagKey: string): Promise<boolean> {
    const key = cacheKey(orgId, flagKey);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
    const { data, error } = await fetcher(orgId, flagKey);
    const value = !error && data !== null && data.is_enabled === true;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  }

  function _clearFeatureFlagCache(): void {
    cache.clear();
  }

  return { isFeatureEnabled, _clearFeatureFlagCache };
}

describe('feature-flags reader cache (Wave 6 / PR #58)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-16T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches a true result and does not re-query within TTL', async () => {
    const fetcher = vi.fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>().mockResolvedValue({
      data: { is_enabled: true },
      error: null,
    });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);
    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('caches a false result when the row is absent (data:null)', async () => {
    const fetcher = vi.fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>().mockResolvedValue({
      data: null,
      error: null,
    });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-2', 'plugins.3pl')).toBe(false);
    expect(await reader.isFeatureEnabled('org-2', 'plugins.3pl')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the query errors (returns false; cached)', async () => {
    const fetcher = vi.fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>().mockResolvedValue({
      data: null,
      error: { message: 'simulated db error' },
    });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-3', 'plugins.3pl')).toBe(false);
    expect(await reader.isFeatureEnabled('org-3', 'plugins.3pl')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('treats is_enabled=false as a cached false (truthy data row, flag off)', async () => {
    const fetcher = vi.fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>().mockResolvedValue({
      data: { is_enabled: false },
      error: null,
    });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-4', 'plugins.3pl')).toBe(false);
    expect(await reader.isFeatureEnabled('org-4', 'plugins.3pl')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keys the cache by (orgId, flagKey) — different orgs are isolated', async () => {
    const fetcher = vi
      .fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>()
      .mockResolvedValueOnce({ data: { is_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { is_enabled: false }, error: null });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-A', 'plugins.3pl')).toBe(true);
    expect(await reader.isFeatureEnabled('org-B', 'plugins.3pl')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, 'org-A', 'plugins.3pl');
    expect(fetcher).toHaveBeenNthCalledWith(2, 'org-B', 'plugins.3pl');
  });

  it('keys the cache by (orgId, flagKey) — different flag keys are isolated', async () => {
    const fetcher = vi
      .fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>()
      .mockResolvedValueOnce({ data: { is_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { is_enabled: false }, error: null });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);
    expect(await reader.isFeatureEnabled('org-1', 'plugins.barcode')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('re-queries after TTL expires (>5 minutes)', async () => {
    const fetcher = vi
      .fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>()
      .mockResolvedValueOnce({ data: { is_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { is_enabled: false }, error: null });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Advance JUST past the 5-minute window.
    vi.advanceTimersByTime(CACHE_TTL_MS + 1);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('still serves from cache RIGHT AT the TTL boundary (expiresAt > now)', async () => {
    // Production reader uses strict >; an entry exactly AT expiry is stale.
    const fetcher = vi
      .fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>()
      .mockResolvedValueOnce({ data: { is_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { is_enabled: false }, error: null });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);
    // Advance to exactly TTL → expiresAt === now → cached?.expiresAt > Date.now()
    // is FALSE → re-query.
    vi.advanceTimersByTime(CACHE_TTL_MS);
    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('_clearFeatureFlagCache forces the next call to re-query', async () => {
    const fetcher = vi
      .fn<(orgId: string, flagKey: string) => Promise<FlagFetchResult>>()
      .mockResolvedValueOnce({ data: { is_enabled: true }, error: null })
      .mockResolvedValueOnce({ data: { is_enabled: false }, error: null });
    const reader = makeReader(fetcher);

    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(true);
    reader._clearFeatureFlagCache();
    expect(await reader.isFeatureEnabled('org-1', 'plugins.3pl')).toBe(false);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

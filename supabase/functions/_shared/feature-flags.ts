/**
 * Feature flag reader.
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Whitelabel Substrate":
 *   org-level flag (`org_feature_flags`) overrides plan default
 *   (`plan_feature_flags`) overrides global default (false unless seeded).
 *
 * Wave 6 / PR #52a — replaces the Wave 0 stub with the real reader.
 * Prereq for Phase 6 3PL plugin gating (PR #56), which guards every
 * ops-api route with `isFeatureEnabled(admin, orgId, 'plugins.3pl')`.
 *
 * Schema (verified via MCP 2026-05-16):
 *   public.org_feature_flags
 *     (org_id uuid NN, flag_key text NN, is_enabled boolean NN DEFAULT false,
 *      config jsonb NN DEFAULT '{}', created_at, created_by, updated_at, updated_by)
 *     UNIQUE (org_id, flag_key)  -- implicit via composite PK pattern
 *
 * Caching: 5-min in-memory Map keyed by (orgId, flagKey). Resets on bundle
 * cold start (acceptable per Phase 6 DoD which requires correctness, not
 * zero-latency). Org-admin flips a flag via settings-api → cache TTL bounds
 * stale read to 5 minutes. Per-instance cache — multi-instance Deno workers
 * each maintain their own; this is fine because flag flips are infrequent
 * and the worst case is one instance lagging by ≤5 minutes.
 *
 * Plan-level + global defaults: Wave 6 ships only the org-level lookup.
 * The `plan_feature_flags` table does not exist on prod; when it lands
 * (Phase 23 admin-console substrate), this helper extends to a 3-tier
 * lookup. For now: absent org row → false (the original architecture
 * default), unless the call site overrides with a different default.
 */

import type { SupabaseClient } from './supabase-admin.ts';

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(orgId: string, flagKey: string): string {
  return `${orgId}::${flagKey}`;
}

/**
 * Returns true iff `org_feature_flags.is_enabled = true` for the (org, key)
 * pair. Returns false on absent row, RLS denial, or query error (fail-closed
 * for plugins; safer than fail-open in case of helper bugs).
 *
 * @param supabase  Service-role admin client (per architecture §8.1, only
 *                  reachable via `createAdminClient()`).
 * @param orgId     Caller's org_id (already authenticated upstream).
 * @param flagKey   Dot-namespaced flag key. Convention: `<domain>.<feature>`
 *                  (e.g. `plugins.3pl`, `crm.leads`, `sales.invoices`).
 */
export async function isFeatureEnabled(
  supabase: SupabaseClient,
  orgId: string,
  flagKey: string,
): Promise<boolean> {
  const key = cacheKey(orgId, flagKey);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const { data, error } = await supabase
    .from('org_feature_flags')
    .select('is_enabled')
    .eq('org_id', orgId)
    .eq('flag_key', flagKey)
    .maybeSingle();

  // Fail-closed: any error or absent row → flag is off. The original Wave 0
  // stub returned false unconditionally; preserve that semantic for callers
  // that have not yet been migrated to handle the error path explicitly.
  const value = !error && data !== null && data.is_enabled === true;

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

/**
 * Legacy alias retained for any pre-Wave-6 callers. New code should use
 * `isFeatureEnabled` directly.
 */
export const readFlag = isFeatureEnabled;

/**
 * Test-only: clear the per-instance cache. Exported for unit + contract
 * tests that need to assert behavior across flag flips within a single
 * test run.
 */
export function _clearFeatureFlagCache(): void {
  cache.clear();
}

export {};

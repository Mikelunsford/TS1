/**
 * Feature flag reader.
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Whitelabel Substrate":
 *  org-level flag (tenant_feature_flags) overrides plan default
 *  (plan_feature_flags) overrides global default.
 *
 * Wave 0: stub. Always returns false. Wave 1+ will implement the lookup
 * against the three tables and add a small in-memory cache keyed by
 * (org_id, key) with a short TTL.
 */

import type { SupabaseClient } from './supabase-admin.ts';

export async function readFlag(
  _supabase: SupabaseClient,
  _orgId: string,
  _key: string,
): Promise<boolean> {
  // TODO Wave 1: read tenant_feature_flags -> plan_feature_flags -> global default.
  return false;
}

export {};

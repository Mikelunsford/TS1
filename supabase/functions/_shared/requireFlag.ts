/**
 * Per-route feature-flag guard (Phase 15).
 *
 * Use at the top of any handler whose entire route family is feature-gated.
 * Reads `org_feature_flags.is_enabled` for `(orgId, flagKey)`; throws
 * `ApiError('FEATURE_DISABLED', ..., 403)` when the flag is off or missing.
 *
 * Rationale (R-W7-OBS-01): bundle-level gating works for plugin-install
 * switches like `plugins.3pl` because the whole bundle is off when the plugin
 * is uninstalled. Phase 15 flags (`finance.expenses`, `inventory.enabled`,
 * `finance.chart_of_accounts`) are feature-within-domain switches — sibling
 * routes (journal entries, invoicing, items) must stay live when the flag is
 * off. Per-route is the right granularity.
 *
 * Caching is via the existing isFeatureEnabled helper (5-min in-memory).
 */

import { isFeatureEnabled } from './feature-flags.ts';
import { ApiError } from './responses.ts';
import type { SupabaseClient } from './supabase-admin.ts';

/**
 * Throws FEATURE_DISABLED (HTTP 403) if `flagKey` is not enabled for `orgId`.
 *
 * The error envelope shape is `{ error: { code: 'FEATURE_DISABLED',
 * message, details: { flag }, request_id } }` — `details.flag` lets the SPA
 * route to `/feature-unavailable` with the right context.
 */
export async function requireFlag(
  supabase: SupabaseClient,
  orgId: string,
  flagKey: string,
): Promise<void> {
  const enabled = await isFeatureEnabled(supabase, orgId, flagKey);
  if (!enabled) {
    throw new ApiError(
      'FEATURE_DISABLED',
      `Feature '${flagKey}' is not enabled for this workspace.`,
      403,
      { flag: flagKey },
    );
  }
}

export {};

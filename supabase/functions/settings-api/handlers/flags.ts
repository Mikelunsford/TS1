/**
 * settings-api — /settings/me/flags handler (Phase 15).
 *
 * Returns the flat shape `{ flag_key: is_enabled }` for the caller's org.
 * No capability gate — every org member can read flags to drive their own
 * SPA gating. RLS on org_feature_flags scopes the read to current_org_id().
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin } from '../_helpers.ts';

export async function getFlagsForMe({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);

  const { data, error } = await admin()
    .from('org_feature_flags')
    .select('flag_key, is_enabled')
    .eq('org_id', caller.orgId);

  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'flags list failed', 500, { detail: error.message });
  }

  const out: Record<string, boolean> = {};
  for (const row of (data ?? []) as Array<{ flag_key: string; is_enabled: boolean }>) {
    out[row.flag_key] = !!row.is_enabled;
  }
  return ok({ flags: out }, undefined, { req });
}

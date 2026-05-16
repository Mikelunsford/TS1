/**
 * collaboration-api — @mention autocomplete.
 * Phase 16 (Wave 10 Session 2) — B1 owns this block.
 *
 * Returns up to 10 org-members whose display_name or email starts-with q
 * (case-insensitive). Uses ILIKE prefix match for index-friendly lookup.
 *
 * Gate: comments.read (mentions are surfaced inside the comment composer).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap } from '../_helpers.ts';

const LIMIT = 10;

export async function autocompleteMentions({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'comments.read');

  const q = (url.searchParams.get('q') ?? '').trim();
  const sb = admin();

  // Pull org memberships first (cap to the user's org), then filter user_profiles.
  const { data: members, error: mErr } = await sb
    .from('org_memberships')
    .select('user_id, role')
    .eq('org_id', caller.orgId);
  if (mErr) {
    throw new ApiError('INTERNAL_ERROR', 'membership lookup failed', 500, { detail: mErr.message });
  }
  const memberIds = (members ?? []).map((m) => m.user_id);
  if (memberIds.length === 0) {
    return ok({ items: [] }, undefined, { req });
  }

  let pq = sb
    .from('user_profiles')
    .select('user_id, display_name, email')
    .in('user_id', memberIds)
    .eq('is_active', true)
    .order('display_name', { ascending: true })
    .limit(LIMIT);

  if (q.length > 0) {
    const safe = q.replace(/[%_]/g, '\\$&');
    pq = pq.or(`display_name.ilike.${safe}%,email.ilike.${safe}%`);
  }

  const { data, error } = await pq;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'mention search failed', 500, { detail: error.message });
  }
  return ok({ items: data ?? [] }, undefined, { req });
}

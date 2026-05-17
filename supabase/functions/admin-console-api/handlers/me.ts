/**
 * GET /admin/me
 * Returns confirmation that the caller is a platform admin + grant metadata.
 * Used by the SPA <AdminShell> to verify before mounting admin routes.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin } from '../_helpers.ts';
import { requirePlatformAdmin } from '../platform-admin.ts';
// ─── Wave 11 MFA gate — Sub-agent A owns this block. ───
import { hasVerifiedTotp } from '../../_shared/mfa.ts';
// ─── End Wave 11 MFA gate. ───

export async function adminMe({ req }: Ctx): Promise<Response> {
  // /admin/me MUST skip MFA enforcement: the SPA polls it to discover whether
  // the user is a platform admin before they've enrolled, then redirects to
  // /admin/enroll-mfa. If we gated /admin/me on MFA, enrollment would be
  // unreachable. The response includes `mfa_verified` so the SPA knows
  // whether to push the user toward enrollment.
  const caller = await requirePlatformAdmin(req, { skipMfa: true });
  const sb = admin();

  const { data, error } = await sb
    .from('platform_admins')
    .select('user_id, granted_at, granted_by')
    .eq('user_id', caller.userId)
    .is('revoked_at', null)
    .single();

  if (error || !data) {
    throw new ApiError('FORBIDDEN', 'platform admin row not found', 403);
  }

  // ─── Wave 11 MFA status check — Sub-agent A owns this block. ───
  // Surface MFA status so the SPA can route to /admin/enroll-mfa before the
  // user hits a MFA_REQUIRED error on the first real admin endpoint.
  const mfaVerified = await hasVerifiedTotp(sb, caller.userId);
  // ─── End Wave 11 MFA status check. ───

  return ok(
    {
      user_id: data.user_id,
      is_platform_admin: true as const,
      granted_at: data.granted_at,
      granted_by: data.granted_by,
      mfa_verified: mfaVerified,
    },
    undefined,
    { req },
  );
}

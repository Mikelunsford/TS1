/**
 * GET /admin/me
 *
 * Returns the caller's platform-admin status as a 200 response body, NOT as
 * a 403 throw on non-admins. The browser network panel logs every 403 as a
 * red "Failed to load resource" entry that JS can't suppress; for a probe
 * endpoint the SPA calls on every mount, that's persistent console noise
 * for every staff user who isn't an admin. Returning 200/false instead
 * keeps the wire clean and the SPA still hides admin chrome based on the
 * boolean (R-W11-MFA-TEST-01).
 *
 * UNAUTHORIZED (401) is still thrown if no JWT — that's a real auth bug,
 * not a status probe. INTERNAL_ERROR (500) is still thrown if the DB
 * lookup fails — a failure must not silently downgrade to "not an admin."
 *
 * MFA is intentionally NOT gated here: the SPA needs to read its own
 * admin status BEFORE the user has enrolled an MFA factor, then route
 * them to /admin/enroll-mfa. mfa_verified is reported as a body field so
 * the SPA can drive the redirect.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { admin } from '../_helpers.ts';
import { decodeAdminJwt } from '../platform-admin.ts';
import { hasVerifiedTotp } from '../../_shared/mfa.ts';
import { error as logError } from '../../_shared/logger.ts';

export async function adminMe({ req }: Ctx): Promise<Response> {
  const caller = decodeAdminJwt(req);
  const sb = admin();

  const { data, error } = await sb
    .from('platform_admins')
    .select('user_id, granted_at, granted_by')
    .eq('user_id', caller.userId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    logError('platform_admin lookup failed (admin/me)', {
      user_id: caller.userId,
      detail: error.message,
    });
    throw new ApiError('INTERNAL_ERROR', 'platform admin lookup failed', 500);
  }

  if (!data) {
    // Non-admin (or revoked admin) — report status, don't 403. SPA reads
    // is_platform_admin to decide whether to render the Admin nav link.
    return ok(
      {
        user_id: caller.userId,
        is_platform_admin: false as const,
        granted_at: null,
        granted_by: null,
        mfa_verified: false,
      },
      undefined,
      { req },
    );
  }

  const mfaVerified = await hasVerifiedTotp(sb, caller.userId);

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

/**
 * admin-console-api — platform-admin gate.
 *
 * SECURITY: every handler in this bundle MUST call `requirePlatformAdmin()`
 * before doing anything else. Platform admin is granted exclusively by an
 * active row in `public.platform_admins`; there is no role-based shortcut.
 *
 * Implementation note: we hit the DB on every request rather than trusting a
 * JWT claim. This trades a single indexed SELECT for the certainty that
 * revocation is effective immediately, with no token-staleness window. The
 * partial index `idx_platform_admins_active_user` makes this an index-only
 * lookup on the hot path.
 */

import { ApiError } from '../_shared/responses.ts';
import { admin } from '../_shared/handler-helpers.ts';
import { requireCaller as requireCallerStrict } from '../_shared/tenant.ts';
import { error as logError } from '../_shared/logger.ts';
// ─── Wave 11 platform_admin MFA gate — Sub-agent A owns this block. ───
// Closes R-W10-P23-OBS-02. Every platform_admin call (except the SPA's
// initial `GET /admin/me` probe, which the enrollment redirect depends on)
// requires a verified TOTP factor. See supabase/functions/_shared/mfa.ts.
import { requireMfaVerified } from '../_shared/mfa.ts';
// ─── End Wave 11 platform_admin MFA gate. ───

export interface PlatformAdminCaller {
  userId: string;
  // The active org claim from the caller's JWT (may be unrelated to any
  // org they're operating on — admins are cross-org by definition). Kept
  // for audit context only; not used as a scoping filter.
  homeOrgId: string | null;
}

export interface RequirePlatformAdminOpts {
  /**
   * Skip the MFA verification step. Used by `GET /admin/me` only — the SPA
   * needs to be able to read its own platform-admin status BEFORE the user
   * has enrolled an MFA factor, so it can redirect them to /admin/enroll-mfa.
   * Every other handler leaves this false so MFA is mandatory.
   */
  skipMfa?: boolean;
}

/**
 * Verify the caller is signed in AND has an active row in `platform_admins`.
 * Throws FORBIDDEN otherwise. We do NOT require an `team1_org_id` claim —
 * platform admins may be signed in without an active membership.
 *
 * Wave 11 (R-W10-P23-OBS-02): after the platform_admins lookup, we ALSO
 * require a verified TOTP factor on the caller's account. Throws
 * `MFA_REQUIRED` (403) when missing. `skipMfa: true` is reserved for the
 * /admin/me self-check the SPA uses to drive enrollment redirects.
 */
export async function requirePlatformAdmin(
  req: Request,
  opts: RequirePlatformAdminOpts = {},
): Promise<PlatformAdminCaller> {
  // Decode the JWT manually rather than calling requireCallerStrict, because
  // the strict variant demands a non-null `team1_org_id` claim — platform
  // admins may not be members of any org.
  const auth = req.headers.get('authorization') ?? req.headers.get('Authorization');
  if (!auth) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required.', 401);
  }
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (!m) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required.', 401);
  }

  // Defer to the shared decoder via requireCallerStrict's lenient sibling
  // (re-imported as needed). Here we inline the same shape for clarity.
  let userId: string | null = null;
  let homeOrgId: string | null = null;
  try {
    const parts = m[1].split('.');
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const payload = JSON.parse(atob(b64 + pad)) as Record<string, unknown>;
    userId = typeof payload.sub === 'string' ? (payload.sub as string) : null;
    const appMeta = (payload.app_metadata as Record<string, unknown> | undefined) ?? {};
    homeOrgId =
      typeof appMeta.team1_org_id === 'string' ? (appMeta.team1_org_id as string) : null;
  } catch (e) {
    throw new ApiError('UNAUTHORIZED', 'Malformed JWT.', 401);
  }

  if (!userId) {
    throw new ApiError('UNAUTHORIZED', 'Authentication required.', 401);
  }

  // Single DB roundtrip — platform_admins lookup via the active partial index.
  const sb = admin();
  const { data, error } = await sb
    .from('platform_admins')
    .select('user_id, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .maybeSingle();

  if (error) {
    logError('platform_admin lookup failed', { user_id: userId, detail: error.message });
    throw new ApiError('INTERNAL_ERROR', 'platform admin lookup failed', 500);
  }
  if (!data) {
    throw new ApiError('FORBIDDEN', 'caller is not a platform admin', 403);
  }

  // ─── Wave 11 platform_admin MFA gate — Sub-agent A owns this block. ───
  // Closes R-W10-P23-OBS-02. /admin/me is the only handler that opts out
  // (so the SPA can detect platform-admin status before enrollment).
  if (!opts.skipMfa) {
    await requireMfaVerified(sb, userId, req);
  }
  // ─── End Wave 11 platform_admin MFA gate. ───

  return { userId, homeOrgId };
}

// Re-export so handlers can use the strict caller form if needed (e.g. for
// reading the caller's home org for the audit metadata).
export { requireCallerStrict };

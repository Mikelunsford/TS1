/**
 * MFA enforcement helper — Wave 11 (R-W10-P23-OBS-02).
 *
 * Platform-admin operations require a verified TOTP factor on the caller's
 * account. We check `auth.mfa_factors` via the admin client and throw
 * `MFA_REQUIRED` (403) if the user has no `factor_type='totp' AND status='verified'`
 * row.
 *
 * Per-request memoization keeps this to one round-trip per invocation even if
 * a handler calls `requireMfaVerified` from multiple code paths. We key the
 * cache on the caller's userId — not the JWT string — because a refresh-rotated
 * JWT for the same user should share the cache slot within a single request.
 *
 * Why this lives in `_shared/` rather than `admin-console-api/`:
 *   - Future privileged bundles (e.g. a finance period_close.reopen action)
 *     may want to gate on MFA without taking a dependency on the admin bundle.
 *   - Tests can mock the supabase client uniformly across bundles.
 */

import type { SupabaseClient } from './supabase-admin.ts';
import { ApiError } from './responses.ts';

const requestCache = new WeakMap<Request, Map<string, boolean>>();

/**
 * Returns void on success; throws ApiError(MFA_REQUIRED, 403) when the user
 * has no verified TOTP factor. The Request parameter is used for per-request
 * memoization only — it is NOT inspected for auth (callers must have already
 * validated the JWT and resolved `userId`).
 *
 * Exposed `__hasVerifiedTotp` is a pure check used by unit tests; production
 * code should call `requireMfaVerified` so the error envelope is uniform.
 */
export async function hasVerifiedTotp(
  sb: SupabaseClient,
  userId: string,
): Promise<boolean> {
  // auth.mfa_factors is in the `auth` schema; service-role bypasses RLS so
  // the admin client can read it directly. `head: false` + count keeps the
  // query an existence check (we don't need the rows themselves).
  const { count, error } = await sb
    .schema('auth')
    .from('mfa_factors')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('factor_type', 'totp')
    .eq('status', 'verified');

  if (error) {
    // Surfacing the underlying error as INTERNAL_ERROR rather than treating
    // it as "no MFA" — a transient DB failure must not silently downgrade
    // the gate to "deny".
    throw new ApiError('INTERNAL_ERROR', 'mfa factor lookup failed', 500, {
      detail: error.message,
    });
  }
  return (count ?? 0) > 0;
}

export async function requireMfaVerified(
  sb: SupabaseClient,
  userId: string,
  req?: Request,
): Promise<void> {
  // Per-request memo
  if (req) {
    let cache = requestCache.get(req);
    if (cache) {
      const hit = cache.get(userId);
      if (hit === true) return;
      if (hit === false) {
        throw new ApiError(
          'MFA_REQUIRED',
          'Platform-admin actions require an enrolled and verified TOTP factor.',
          403,
        );
      }
    } else {
      cache = new Map();
      requestCache.set(req, cache);
    }
    const ok = await hasVerifiedTotp(sb, userId);
    cache.set(userId, ok);
    if (!ok) {
      throw new ApiError(
        'MFA_REQUIRED',
        'Platform-admin actions require an enrolled and verified TOTP factor.',
        403,
      );
    }
    return;
  }

  const ok = await hasVerifiedTotp(sb, userId);
  if (!ok) {
    throw new ApiError(
      'MFA_REQUIRED',
      'Platform-admin actions require an enrolled and verified TOTP factor.',
      403,
    );
  }
}

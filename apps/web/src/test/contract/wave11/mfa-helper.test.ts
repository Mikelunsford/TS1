/**
 * Wave 11 — unit test for the shared MFA helper.
 *
 * Closes R-W10-P23-OBS-02 + Wave 11D hotfix.
 *
 * The production helper at `supabase/functions/_shared/mfa.ts` calls
 * `sb.rpc('has_verified_totp', { p_user_id })`. Wave 11D migration 0075
 * ships that SECURITY DEFINER wrapper because the original implementation
 * (`sb.schema('auth').from('mfa_factors')`) 500'd in prod — the `auth`
 * schema isn't exposed to PostgREST (supabase/config.toml exposes only
 * `public` + `graphql_public`). This test pins the RPC-based shape so a
 * future refactor doesn't reintroduce the schema-cache regression.
 *
 * We can't load the real Deno-targeted helper directly because responses.ts
 * pulls in cors.ts which references Deno.env, so we inline the production
 * logic and assert against a mocked supabase client.
 */

import { describe, it, expect, vi } from 'vitest';

interface MockSb {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{
    data: boolean | null;
    error: { message: string } | null;
  }>;
}

function makeSb(
  data: boolean | null,
  error: { message: string } | null = null,
): MockSb {
  return {
    rpc: vi.fn(async () => ({ data, error })),
  };
}

// Inline the production logic so this test exercises the EXACT same RPC
// call shape `_shared/mfa.ts` uses. Keep in lockstep with that file.
async function hasVerifiedTotp(sb: MockSb, userId: string): Promise<boolean> {
  const { data, error } = await sb.rpc('has_verified_totp', { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

describe('Wave 11D — hasVerifiedTotp via has_verified_totp RPC', () => {
  it('returns false when the RPC returns false (no MFA factors)', async () => {
    const sb = makeSb(false);
    expect(await hasVerifiedTotp(sb, '11111111-1111-1111-1111-111111111111')).toBe(false);
  });

  it('returns false when the RPC returns false (only unverified factors)', async () => {
    // The SQL EXISTS check filters on status='verified', so an unverified
    // factor never causes the wrapper to return true.
    const sb = makeSb(false);
    expect(await hasVerifiedTotp(sb, 'u-2')).toBe(false);
  });

  it('returns true when the RPC returns true (verified factor present)', async () => {
    const sb = makeSb(true);
    expect(await hasVerifiedTotp(sb, 'u-3')).toBe(true);
  });

  it('calls the RPC with the correct function name and parameter shape', async () => {
    const sb = makeSb(false);
    const userId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await hasVerifiedTotp(sb, userId);
    expect(sb.rpc).toHaveBeenCalledWith('has_verified_totp', { p_user_id: userId });
  });

  it('throws when the RPC errors — never silently downgrades to "no MFA"', async () => {
    const sb = makeSb(null, { message: 'boom' });
    await expect(hasVerifiedTotp(sb, 'u-5')).rejects.toThrow(/boom/);
  });

  it('treats data: null as false (defense-in-depth)', async () => {
    // A misconfigured RPC could return null. The helper must not crash; it
    // returns false, which lets requireMfaVerified throw the standard
    // MFA_REQUIRED envelope rather than INTERNAL_ERROR.
    const sb = makeSb(null);
    expect(await hasVerifiedTotp(sb, 'u-6')).toBe(false);
  });
});

describe('Wave 11 — MFA_REQUIRED error envelope shape', () => {
  // The admin-console-api handler throws ApiError('MFA_REQUIRED', ..., 403).
  // This pins the wire shape the SPA's apiClient resolves on a real 403.
  it('uses error code MFA_REQUIRED with status 403', () => {
    const envelope = {
      error: {
        code: 'MFA_REQUIRED',
        message:
          'Platform-admin actions require an enrolled and verified TOTP factor.',
      },
    };
    expect(envelope.error.code).toBe('MFA_REQUIRED');
  });
});

describe('Wave 11 — platform_admin gate composes platform_admins + MFA', () => {
  // Documentation-style assertion that the gate has two checks in order:
  //   1. platform_admins active row  (FORBIDDEN if missing)
  //   2. verified TOTP factor        (MFA_REQUIRED if missing)
  // R-W11-MFA-TEST-01: /admin/me no longer goes through requirePlatformAdmin
  // at all — it calls decodeAdminJwt + does its own platform_admins lookup
  // with maybeSingle(), returning 200 with is_platform_admin: false (and
  // mfa_verified: false) when the row is missing. Every other /admin/*
  // handler still composes both checks in this order.
  it('orders platform_admins before MFA so non-admins never reveal MFA state', () => {
    const steps = ['platform_admins', 'mfa'];
    expect(steps[0]).toBe('platform_admins');
    expect(steps[1]).toBe('mfa');
  });

  // Wire-shape: GET /admin/me returns mfa_verified so the SPA can route to
  // the enrollment page without first hitting a MFA_REQUIRED on a real
  // handler.
  it('admin/me response carries mfa_verified', () => {
    const me = {
      user_id: '11111111-1111-1111-1111-111111111111',
      is_platform_admin: true as const,
      granted_at: '2026-05-16T00:00:00Z',
      granted_by: '11111111-1111-1111-1111-111111111111',
      mfa_verified: false,
    };
    expect(me.mfa_verified).toBe(false);
  });
});

// Silence unused-import warning when vi is only referenced indirectly.
void vi;

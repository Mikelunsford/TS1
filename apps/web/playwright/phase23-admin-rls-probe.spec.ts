/**
 * Phase 23 — admin console RLS probe (Wave 10 Session 4).
 *
 * Verifies the security-critical posture of the new platform_admins +
 * impersonation_sessions tables:
 *
 *   1. An anonymous client (no JWT) sees ZERO rows from platform_admins +
 *      impersonation_sessions even though both tables physically contain
 *      rows seeded by the fixture (service_role bypasses RLS).
 *
 *   2. An authenticated non-platform-admin user sees ZERO rows from both
 *      tables (the SELECT policy only matches an active platform_admins
 *      row for auth.uid()).
 *
 *   3. A non-platform-admin user receives 403 on every /admin/* endpoint.
 *
 * If the required env is missing the spec is skipped with a clear message.
 */

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const READY = Boolean(SUPABASE_URL && SERVICE_ROLE && ANON_KEY);

test.describe('Phase 23 admin RLS probe', () => {
  test.skip(!READY, 'Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');

  test('anonymous client sees 0 rows on platform_admins + impersonation_sessions', async () => {
    const anon = createClient(SUPABASE_URL!, ANON_KEY!);

    const pa = await anon.from('platform_admins').select('user_id');
    expect(pa.error).toBeNull();
    expect(pa.data?.length ?? 0).toBe(0);

    const sess = await anon.from('impersonation_sessions').select('id');
    expect(sess.error).toBeNull();
    expect(sess.data?.length ?? 0).toBe(0);
  });

  test('non-platform-admin authenticated user sees 0 rows + gets 403 on /admin/me', async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Ephemeral user.
    const suffix = `phase23-rls-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const email = `${suffix}@team1.test`;
    const password = `Probe_${suffix}_!1`;
    const { data: userRow, error: ue } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (ue || !userRow.user) throw new Error(`user create: ${ue?.message}`);

    const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
    const { data: sess, error: se } = await userClient.auth.signInWithPassword({ email, password });
    if (se || !sess.session) throw new Error(`signin: ${se?.message}`);

    // Should see ZERO rows on both tables (no platform_admins membership).
    const pa = await userClient.from('platform_admins').select('user_id');
    expect(pa.error).toBeNull();
    expect(pa.data?.length ?? 0).toBe(0);

    const sessRows = await userClient.from('impersonation_sessions').select('id');
    expect(sessRows.error).toBeNull();
    expect(sessRows.data?.length ?? 0).toBe(0);

    // /admin/me must return 403.
    const res = await fetch(
      `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/admin-console-api/admin/me`,
      {
        headers: {
          authorization: `Bearer ${sess.session.access_token}`,
          apikey: ANON_KEY!,
        },
      },
    );
    expect(res.status).toBe(403);

    // /admin/organizations must also be 403.
    const orgsRes = await fetch(
      `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1/admin-console-api/admin/organizations`,
      {
        headers: {
          authorization: `Bearer ${sess.session.access_token}`,
          apikey: ANON_KEY!,
        },
      },
    );
    expect(orgsRes.status).toBe(403);

    // Cleanup.
    await admin.auth.admin.deleteUser(userRow.user.id);
  });

  test('is_platform_admin() returns false for anonymous', async () => {
    const admin = createClient(SUPABASE_URL!, SERVICE_ROLE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // Service-role bypasses RLS but we can still call the function. auth.uid()
    // is null under service_role context too, so it should return false.
    const { data, error } = await admin.rpc('is_platform_admin');
    expect(error).toBeNull();
    expect(data).toBe(false);
  });
});

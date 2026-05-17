import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 23 (Wave 10 Session 4) — admin console e2e.
 *
 * Tags: @phase23 @admin @smoke
 *
 * Sequence:
 *   1. Bootstrap: org A + owner user; ephemeral platform-admin user (seeded
 *      directly into public.platform_admins via service role).
 *   2. Admin calls GET /admin/me → 200 with is_platform_admin=true.
 *   3. Admin calls GET /admin/organizations → returns at least the seeded org.
 *   4. Admin calls GET /admin/organizations/:id → owner is in memberships.
 *   5. Admin calls POST /admin/impersonate { user_id, org_id, reason } →
 *      returns session_id + access_token.
 *   6. Verify a row was inserted into impersonation_sessions for the admin.
 *   7. Verify a row was inserted into audit_log with
 *      entity_type='impersonation' + action='platform_admin.impersonate.start'.
 *   8. Admin calls POST /admin/impersonate/end { session_id } → 200,
 *      session row has ended_at set.
 *   9. Cleanup.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const READY = Boolean(SUPABASE_URL && SERVICE_ROLE && ANON_KEY);

function functionsBase(): string {
  return `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1`;
}
function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface User {
  user_id: string;
  email: string;
  password: string;
  access_token: string;
}

async function makeUser(orgId: string | null, role: string | null, label: string): Promise<User> {
  const admin = adminClient();
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `phase23-${suffix}@team1.test`;
  const password = `Smoke_${suffix}!1`;
  const appMeta: Record<string, unknown> = {};
  if (orgId) appMeta.team1_org_id = orgId;
  if (role) appMeta.team1_org_role = role;
  const { data: u, error: ue } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: appMeta,
  });
  if (ue || !u.user) throw new Error(`user create: ${ue?.message}`);
  await admin.from('profiles').upsert({ user_id: u.user.id, email, display_name: label });

  const cli = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: s, error: se } = await cli.auth.signInWithPassword({ email, password });
  if (se || !s.session) throw new Error(`signin: ${se?.message}`);
  return { user_id: u.user.id, email, password, access_token: s.session.access_token };
}

interface Fixture {
  org_id: string;
  owner: User;
  admin: User; // platform admin
}

async function bootstrap(): Promise<Fixture> {
  const sb = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `phase23-${suffix}`.slice(0, 63).toLowerCase();
  const { data: org, error: oe } = await sb
    .from('organizations')
    .insert({ slug, display_name: `Phase23 ${suffix}` })
    .select('id')
    .single();
  if (oe || !org) throw new Error(`org create: ${oe?.message}`);

  const owner = await makeUser(org.id, 'org_owner', 'owner');

  const { data: roleRow } = await sb.from('roles').select('id').eq('code', 'org_owner').single();
  await sb.from('org_memberships').insert({
    org_id: org.id,
    user_id: owner.user_id,
    role_id: roleRow!.id,
    is_active: true,
  });

  // Platform admin — no org membership.
  const admin = await makeUser(null, null, 'platadmin');
  await sb.from('platform_admins').insert({
    user_id: admin.user_id,
    granted_by: admin.user_id,
    notes: 'wave10-admin-console-flow.spec.ts',
  });

  return { org_id: org.id as string, owner, admin };
}

async function cleanup(fx: Fixture) {
  const sb = adminClient();
  await sb.from('impersonation_sessions').delete().eq('admin_user_id', fx.admin.user_id);
  await sb.from('platform_admins').delete().eq('user_id', fx.admin.user_id);
  await sb.from('org_memberships').delete().eq('org_id', fx.org_id);
  await sb.from('organizations').delete().eq('id', fx.org_id);
  await sb.auth.admin.deleteUser(fx.owner.user_id).catch(() => null);
  await sb.auth.admin.deleteUser(fx.admin.user_id).catch(() => null);
}

test.describe('Phase 23 admin console e2e', () => {
  test.skip(!READY, 'Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY');

  test('full admin → impersonate → end flow + audit trail', async () => {
    const fx = await bootstrap();
    try {
      const baseAdminHeaders = {
        authorization: `Bearer ${fx.admin.access_token}`,
        apikey: ANON_KEY!,
        'content-type': 'application/json',
      };

      // 1. GET /admin/me
      const meRes = await fetch(`${functionsBase()}/admin-console-api/admin/me`, {
        headers: baseAdminHeaders,
      });
      expect(meRes.status).toBe(200);
      const meBody = await meRes.json();
      expect(meBody.data.is_platform_admin).toBe(true);

      // 2. GET /admin/organizations
      const orgsRes = await fetch(`${functionsBase()}/admin-console-api/admin/organizations`, {
        headers: baseAdminHeaders,
      });
      expect(orgsRes.status).toBe(200);
      const orgsBody = await orgsRes.json();
      const foundOrg = orgsBody.data.items.find((o: { id: string }) => o.id === fx.org_id);
      expect(foundOrg).toBeDefined();

      // 3. GET /admin/organizations/:id
      const detailRes = await fetch(
        `${functionsBase()}/admin-console-api/admin/organizations/${fx.org_id}`,
        { headers: baseAdminHeaders },
      );
      expect(detailRes.status).toBe(200);
      const detailBody = await detailRes.json();
      const ownerInList = detailBody.data.memberships.find(
        (m: { user_id: string }) => m.user_id === fx.owner.user_id,
      );
      expect(ownerInList).toBeDefined();

      // 4. POST /admin/impersonate
      const impRes = await fetch(`${functionsBase()}/admin-console-api/admin/impersonate`, {
        method: 'POST',
        headers: { ...baseAdminHeaders, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          user_id: fx.owner.user_id,
          org_id: fx.org_id,
          reason: 'e2e smoke test impersonation',
        }),
      });
      expect(impRes.status).toBe(201);
      const impBody = await impRes.json();
      expect(impBody.data.session_id).toBeTruthy();
      // Wave 11 (R-W10-P23-OBS-01): impersonation TTL was 3600 → now 900s.
      expect(impBody.data.expires_in).toBe(900);
      expect(typeof impBody.data.expires_at).toBe('string');
      const sessionId = impBody.data.session_id as string;

      // 5. Verify impersonation_sessions row.
      const sb = adminClient();
      const { data: sessRow } = await sb
        .from('impersonation_sessions')
        .select('id, admin_user_id, impersonated_user_id, org_id, reason, ended_at')
        .eq('id', sessionId)
        .single();
      expect(sessRow?.admin_user_id).toBe(fx.admin.user_id);
      expect(sessRow?.impersonated_user_id).toBe(fx.owner.user_id);
      expect(sessRow?.org_id).toBe(fx.org_id);
      expect(sessRow?.ended_at).toBeNull();

      // 6. Verify audit_log row.
      const { data: auditRows } = await sb
        .from('audit_log')
        .select('id, action, entity_type, entity_id')
        .eq('entity_type', 'impersonation')
        .eq('entity_id', sessionId)
        .eq('action', 'platform_admin.impersonate.start');
      expect((auditRows ?? []).length).toBeGreaterThanOrEqual(1);

      // 7. POST /admin/impersonate/end
      const endRes = await fetch(`${functionsBase()}/admin-console-api/admin/impersonate/end`, {
        method: 'POST',
        headers: { ...baseAdminHeaders, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ session_id: sessionId }),
      });
      expect(endRes.status).toBe(200);

      const { data: endedRow } = await sb
        .from('impersonation_sessions')
        .select('ended_at')
        .eq('id', sessionId)
        .single();
      expect(endedRow?.ended_at).not.toBeNull();
    } finally {
      await cleanup(fx);
    }
  });
});

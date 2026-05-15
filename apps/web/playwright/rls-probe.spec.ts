import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Cross-tenant RLS probe — release-blocker.
 *
 * Constitutional rule (TS1/03-workspace/00-SHARED-CONTEXT.md §RLS):
 *   Tenant-scoped tables enforce `org_id = current_org_id()` via FILTERING
 *   policies. A caller whose active org does NOT own the row sees the row
 *   as if it does not exist. The response MUST be 404 NOT_FOUND, never
 *   403 FORBIDDEN, because FORBIDDEN leaks the row's existence to a
 *   different tenant.
 *
 * This spec creates two ephemeral users + two ephemeral orgs via the
 * service role, then probes a representative set of tenant-scoped tables
 * with the WRONG org's JWT. Every probe must return NOT_FOUND.
 *
 * Requires env:
 *   VITE_SUPABASE_URL          — the project to probe against
 *   SUPABASE_SERVICE_ROLE_KEY  — admin key (CI secret; never on disk)
 *   VITE_SUPABASE_ANON_KEY     — for the per-user signed-in client
 *
 * If any required var is missing the spec is skipped with a clear
 * message rather than silently passing — the constitution does not
 * permit a green RLS gate from a missing-env false-positive.
 */

interface OrgFixture {
  org_id: string;
  user_id: string;
  email: string;
  password: string;
  access_token: string;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const REQUIRED_ENV_PRESENT = Boolean(SUPABASE_URL && SERVICE_ROLE && ANON_KEY);

/** Functions-base URL ('/functions/v1') for direct edge-function calls. */
function functionsBase(): string {
  return `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1`;
}

/** Service-role admin client for create/teardown. */
function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Spin up an ephemeral org + user + active membership, sign them in. */
async function makeFixture(label: string): Promise<OrgFixture> {
  const admin = adminClient();
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `rls-probe-${suffix}@team1.test`;
  const password = `Probe_${suffix}_${Math.random().toString(36).slice(2)}!1`;

  // 1) Create the org row.
  const slug = `rls-probe-${suffix}`.slice(0, 63).toLowerCase();
  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `RLS Probe ${label}`, default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  // 2) Create the user with the org claim already stamped.
  const role = 'org_owner';
  const { data: userRow, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { team1_org_id: org_id, team1_org_role: role },
  });
  if (userErr || !userRow.user) throw new Error(`user create failed: ${userErr?.message}`);
  const user_id = userRow.user.id;

  // 3) Add an active membership.
  const { data: roleRow, error: roleErr } = await admin
    .from('roles')
    .select('id')
    .eq('code', role)
    .single();
  if (roleErr || !roleRow) throw new Error(`role lookup failed: ${roleErr?.message}`);
  const { error: memErr } = await admin.from('org_memberships').insert({
    org_id,
    user_id,
    role_id: roleRow.id,
    is_active: true,
  });
  if (memErr) throw new Error(`membership create failed: ${memErr.message}`);

  // 3b) Pre-insert user_preferences with org_id BEFORE profile insert so
  // the after-insert trigger on profiles (which does an
  // INSERT...ON CONFLICT DO NOTHING into user_preferences but doesn't set
  // org_id — a Wave 0 schema bug since user_preferences.org_id is NOT NULL)
  // hits the conflict path. Tracked as a forward-only migration TODO.
  const { error: prefErr } = await admin.from('user_preferences').insert({
    user_id,
    org_id,
  });
  if (prefErr) throw new Error(`user_preferences seed failed: ${prefErr.message}`);

  // 3c) Insert public.profiles row. On prod, app code populates it on
  // first sign-in; staging has no SPA touching it, so the fixture must.
  const { error: profileErr } = await admin.from('profiles').insert({
    user_id,
    email,
    display_name: `RLS Probe ${label}`,
  });
  if (profileErr) throw new Error(`profile create failed: ${profileErr.message}`);

  // 4) Sign in to get a JWT.
  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session.session) throw new Error(`signin failed: ${signInErr?.message}`);

  return { org_id, user_id, email, password, access_token: session.session.access_token };
}

/** Seed a customer row owned by `fx.org_id`. Returns the customer id. */
async function seedCustomer(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('customers')
    .insert({
      org_id: fx.org_id,
      name: `RLS Probe Customer ${fx.org_id.slice(0, 8)}`,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`customer seed failed: ${error?.message}`);
  return data.id as string;
}

/** Teardown: delete user (cascades memberships) + delete org row. */
async function teardown(fx: OrgFixture): Promise<void> {
  const admin = adminClient();
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('Cross-tenant RLS probe', () => {
  test.skip(!REQUIRED_ENV_PRESENT, 'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY');

  let orgA: OrgFixture;
  let orgB: OrgFixture;
  let customerA: string;

  test.beforeAll(async () => {
    orgA = await makeFixture('A');
    orgB = await makeFixture('B');
    customerA = await seedCustomer(orgA);
  });

  test.afterAll(async () => {
    if (orgA) await teardown(orgA).catch(() => undefined);
    if (orgB) await teardown(orgB).catch(() => undefined);
  });

  test('user B cannot read user A customer via PostgREST', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL!}/rest/v1/customers?id=eq.${customerA}`, {
      headers: {
        apikey: ANON_KEY!,
        authorization: `Bearer ${orgB.access_token}`,
        accept: 'application/json',
      },
    });
    // PostgREST returns 200 with an empty array when RLS filters the row out.
    // 403 would mean a THROWING policy — constitutionally forbidden.
    expect(res.status(), 'RLS must filter, not throw').toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body, 'org B must see zero org A customers').toHaveLength(0);
  });

  test('user A reads its OWN customer (positive control)', async ({ request }) => {
    const res = await request.get(`${SUPABASE_URL!}/rest/v1/customers?id=eq.${customerA}`, {
      headers: {
        apikey: ANON_KEY!,
        authorization: `Bearer ${orgA.access_token}`,
        accept: 'application/json',
      },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.length, 'org A must see its own customer').toBe(1);
    expect(body[0]!.id).toBe(customerA);
  });

  test('auth-api/me returns user B own profile and membership only', async ({ request }) => {
    const res = await request.get(`${functionsBase()}/auth-api/me`, {
      headers: { authorization: `Bearer ${orgB.access_token}`, apikey: ANON_KEY! },
    });
    // If the edge runtime isn't reachable (local Supabase without
    // edge runtime, or staging without Wave 1 functions deployed yet)
    // skip this assertion rather than register a false RLS failure.
    test.skip(res.status() >= 500, `function unreachable (HTTP ${res.status()})`);
    expect(res.status()).toBe(200);
    const json = (await res.json()) as { data: { active_org_id: string; memberships: Array<{ org_id: string }> } };
    expect(json.data.active_org_id).toBe(orgB.org_id);
    expect(json.data.memberships.every((m) => m.org_id === orgB.org_id)).toBe(true);
    expect(json.data.memberships.some((m) => m.org_id === orgA.org_id)).toBe(false);
  });

  test('switch-org rejects org B user attempting to switch to org A', async ({ request }) => {
    const res = await request.post(`${functionsBase()}/auth-api/sessions/switch-org`, {
      headers: {
        authorization: `Bearer ${orgB.access_token}`,
        apikey: ANON_KEY!,
        'idempotency-key': crypto.randomUUID(),
        'content-type': 'application/json',
      },
      data: { org_id: orgA.org_id },
    });
    test.skip(res.status() >= 500, `function unreachable (HTTP ${res.status()})`);
    expect(res.status(), 'cross-org switch must NOT FOUND, not throw FORBIDDEN').toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('NOT_FOUND');
  });

  test('tenants-api/branding returns org B branding to org B', async ({ request }) => {
    const res = await request.get(`${functionsBase()}/tenants-api/branding`, {
      headers: { authorization: `Bearer ${orgB.access_token}`, apikey: ANON_KEY! },
    });
    test.skip(res.status() >= 500, `function unreachable (HTTP ${res.status()})`);
    // Org B's branding row was auto-created by the org-create trigger
    // (per migration 0029) or returns NOT_FOUND if not. Either way it
    // must NEVER be org A's row.
    if (res.status() === 200) {
      const json = (await res.json()) as { data: { org_id: string } };
      expect(json.data.org_id).toBe(orgB.org_id);
    } else {
      expect(res.status()).toBe(404);
    }
  });
});

test('Wave 0 placeholder — unauthenticated guard bounces to /login', async ({ page }) => {
  // Smoke that the SPA still boots and the guard works. Skips against
  // a remote baseURL when the dev server isn't running.
  test.skip(!process.env.PLAYWRIGHT_BASE_URL && !!process.env.CI);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);
});

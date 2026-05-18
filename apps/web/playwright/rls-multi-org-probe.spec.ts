import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Multi-org RLS probe — regression guard for AUDIT-2026-05-18 §5 C-1.
 *
 * Background
 * ----------
 * Migration 0077 fixed `public.current_org_id()` to read
 * `app_metadata.team1_org_id` (the claim the SPA + edge functions actually
 * stamp) instead of a root-level `org_id` claim (which nothing writes).
 * The pre-fix behavior fell through to a no-ORDER-BY `org_memberships`
 * lookup that silently pinned multi-org users to "first membership."
 *
 * Why this spec exists
 * --------------------
 * The existing `rls-probe.spec.ts` creates two SINGLE-org users and proves
 * cross-tenant access returns 404. It does NOT exercise the multi-org
 * case the C-1 bug actually broke. Without this spec, any future
 * regression of the same class (reading the wrong claim name) passes CI
 * silently — exactly how C-1 survived for 12 waves.
 *
 * What this spec asserts
 * ----------------------
 *   1. A user with active memberships in orgs A + B, whose JWT carries
 *      `team1_org_id = A`, sees `current_org_id() = A`.
 *   2. After re-stamping the claim to B and re-signing-in,
 *      `current_org_id() = B`.
 *   3. With no `team1_org_id` claim stamped at all, `current_org_id()`
 *      returns NULL — proving the membership-table fallback is gone
 *      (otherwise the function would silently impersonate one of the two
 *      memberships).
 *
 * Requires the same staging env as `rls-probe.spec.ts`:
 *   VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY.
 * Missing env => spec skips with a clear message (no silent green).
 *
 * NEVER point this at prod — it creates and tears down orgs + memberships.
 */

interface MultiOrgFixture {
  user_id: string;
  email: string;
  password: string;
  org_a: string;
  org_b: string;
  role_id: string;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const REQUIRED_ENV_PRESENT = Boolean(SUPABASE_URL && SERVICE_ROLE && ANON_KEY);

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function createOrg(admin: SupabaseClient, label: string): Promise<string> {
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `rls-multiorg-${suffix}`.slice(0, 63).toLowerCase();
  const { data, error } = await admin
    .from('organizations')
    .insert({ slug, display_name: `RLS Multi-Org ${label}`, default_currency_code: 'USD' })
    .select('id')
    .single();
  if (error || !data) throw new Error(`org create (${label}) failed: ${error?.message}`);
  return data.id as string;
}

async function buildFixture(): Promise<MultiOrgFixture> {
  const admin = adminClient();

  // Look up the org_owner role once — both memberships use it.
  const { data: roleRow, error: roleErr } = await admin
    .from('roles')
    .select('id')
    .eq('code', 'org_owner')
    .single();
  if (roleErr || !roleRow) throw new Error(`role lookup failed: ${roleErr?.message}`);
  const role_id = roleRow.id as string;

  const org_a = await createOrg(admin, 'A');
  const org_b = await createOrg(admin, 'B');

  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `rls-multiorg-${suffix}@team1.test`;
  const password = `MultiOrg_${suffix}_${Math.random().toString(36).slice(2)}!1`;

  // Create the user with the org A claim already stamped (so the initial
  // sign-in establishes a known starting state).
  const { data: userRow, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { team1_org_id: org_a, team1_org_role: 'org_owner' },
  });
  if (userErr || !userRow.user) throw new Error(`user create failed: ${userErr?.message}`);
  const user_id = userRow.user.id;

  // Active membership in BOTH orgs — this is what makes the fixture
  // "multi-org" and triggers the pre-fix fallback ambiguity.
  for (const org_id of [org_a, org_b]) {
    const { error: memErr } = await admin.from('org_memberships').insert({
      org_id,
      user_id,
      role_id,
      is_active: true,
    });
    if (memErr) throw new Error(`membership create (${org_id}) failed: ${memErr.message}`);
  }

  // Pre-insert user_preferences with org A so the profile-insert trigger
  // (which fires INSERT ON CONFLICT DO NOTHING on user_preferences) hits
  // the conflict path — same Wave-0 schema quirk noted in rls-probe.spec.ts.
  const { error: prefErr } = await admin.from('user_preferences').insert({
    user_id,
    org_id: org_a,
  });
  if (prefErr) throw new Error(`user_preferences seed failed: ${prefErr.message}`);

  const { error: profileErr } = await admin.from('profiles').insert({
    user_id,
    email,
    display_name: 'RLS Multi-Org Probe',
  });
  if (profileErr) throw new Error(`profile create failed: ${profileErr.message}`);

  return { user_id, email, password, org_a, org_b, role_id };
}

/**
 * Sign in as the fixture user and return a fresh access token. Used after
 * every `app_metadata` change to mint a JWT that carries the new claim
 * (updateUserById mutates the row but does not push the new claim to
 * existing sessions).
 */
async function freshToken(fx: MultiOrgFixture): Promise<string> {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await c.auth.signInWithPassword({
    email: fx.email,
    password: fx.password,
  });
  if (error || !data.session) throw new Error(`signin failed: ${error?.message}`);
  return data.session.access_token;
}

/**
 * Call `current_org_id()` via RPC as the authenticated user (token-bound
 * client). Returns the function's return value (a uuid string or null).
 */
async function callCurrentOrgId(token: string): Promise<string | null> {
  const c = createClient(SUPABASE_URL!, ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await c.rpc('current_org_id');
  if (error) throw new Error(`current_org_id rpc failed: ${error.message}`);
  // PostgREST returns scalar UUIDs as strings; null comes through as null.
  return (data ?? null) as string | null;
}

async function teardown(fx: MultiOrgFixture): Promise<void> {
  const admin = adminClient();
  // Best-effort cleanup; order matters because of FKs.
  await admin.from('org_memberships').delete().eq('user_id', fx.user_id);
  await admin.from('user_preferences').delete().eq('user_id', fx.user_id);
  await admin.from('profiles').delete().eq('user_id', fx.user_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('organizations').delete().in('id', [fx.org_a, fx.org_b]);
}

test.describe('multi-org RLS — current_org_id() respects the active JWT claim', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / VITE_SUPABASE_ANON_KEY — skipping (no silent green).',
  );

  let fx: MultiOrgFixture | undefined;

  test.beforeAll(async () => {
    fx = await buildFixture();
  });

  test.afterAll(async () => {
    if (fx) await teardown(fx);
  });

  test('claim = orgA => current_org_id() returns orgA', async () => {
    const token = await freshToken(fx!);
    const got = await callCurrentOrgId(token);
    expect(got).toBe(fx!.org_a);
  });

  test('claim switched to orgB + re-signin => current_org_id() returns orgB (not "first membership")', async () => {
    const admin = adminClient();
    const { error } = await admin.auth.admin.updateUserById(fx!.user_id, {
      app_metadata: { team1_org_id: fx!.org_b, team1_org_role: 'org_owner' },
    });
    if (error) throw new Error(`updateUserById failed: ${error.message}`);

    const token = await freshToken(fx!); // mints a JWT with the new claim
    const got = await callCurrentOrgId(token);
    expect(got).toBe(fx!.org_b);
  });

  test('claim cleared => current_org_id() returns NULL (membership fallback is dropped)', async () => {
    const admin = adminClient();
    // Strip the org claim entirely.
    const { error } = await admin.auth.admin.updateUserById(fx!.user_id, {
      app_metadata: {},
    });
    if (error) throw new Error(`updateUserById (clear) failed: ${error.message}`);

    const token = await freshToken(fx!);
    const got = await callCurrentOrgId(token);
    // Pre-0077 this would have returned one of the two memberships
    // silently. Post-0077 it must be NULL — that's the regression guard.
    expect(got).toBeNull();
  });
});

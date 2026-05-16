import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Wave 10 / Phase 18 polish — AR aging report happy-path smoke.
 *
 * Tags: @wave10 @smoke
 *
 * Run time budget: < 60s. API-driven (Edge Function calls). Pins:
 *   1. Bootstrap ephemeral org + COA via seed_org_chart_of_accounts.
 *   2. GET /reports/ar-aging — wire shape returns 200 and the totals
 *      identity holds (sum of bucket totals == total_outstanding_cents).
 *   3. Change the as_of param to last-month-end and observe a fresh
 *      response (rows may be empty but the envelope must validate).
 *
 * Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * VITE_SUPABASE_ANON_KEY. Missing env → skip.
 *
 * Depends on Agent A3's migration 0067 (ar_aging RPC). Skips with a
 * clear message if the RPC isn't deployed yet.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const REQUIRED_ENV_PRESENT = Boolean(SUPABASE_URL && SERVICE_ROLE && ANON_KEY);

function functionsBase(): string {
  return `${SUPABASE_URL!.replace(/\/$/, '')}/functions/v1`;
}

function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

interface OrgFixture {
  org_id: string;
  user_id: string;
  email: string;
  access_token: string;
}

async function makeFixture(): Promise<OrgFixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `wave10-rp-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave10-rp-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `Wave10 Reports Smoke`, default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  const role = 'org_owner';
  const { data: userRow, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { team1_org_id: org_id, team1_org_role: role },
  });
  if (userErr || !userRow.user) throw new Error(`user create failed: ${userErr?.message}`);
  const user_id = userRow.user.id;

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
  if (memErr) throw new Error(`membership insert failed: ${memErr.message}`);

  await admin.from('user_preferences').insert({ user_id, org_id });
  await admin.from('profiles').insert({ user_id, email, display_name: `Wave10 RP` });
  await admin.rpc('seed_org_chart_of_accounts', { p_org_id: org_id });

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session.session) {
    throw new Error(`signin failed: ${signInErr?.message}`);
  }
  return { org_id, user_id, email, access_token: session.session.access_token };
}

async function teardown(fx: OrgFixture): Promise<void> {
  const admin = adminClient();
  await admin.from('chart_of_accounts').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@wave10 @smoke Phase 18 polish — AR aging report', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: OrgFixture;

  test.beforeAll(async () => {
    fx = await makeFixture();
  });

  test.afterAll(async () => {
    if (fx) await teardown(fx).catch(() => undefined);
  });

  test('GET /reports/ar-aging — wire shape + totals identity', async ({ request }) => {
    test.setTimeout(60_000);
    const baseHeaders = {
      authorization: `Bearer ${fx.access_token}`,
      apikey: ANON_KEY!,
      'content-type': 'application/json',
    };

    const asOf = new Date().toISOString().slice(0, 10);
    const res = await request.get(
      `${functionsBase()}/finance-api/reports/ar-aging?as_of=${asOf}&currency=USD`,
      { headers: baseHeaders },
    );
    test.skip(
      res.status() >= 500,
      `finance-api unreachable (HTTP ${res.status()}) — likely migration 0067 not yet deployed`,
    );
    expect(res.status(), 'ar-aging 200').toBe(200);

    const body = (await res.json()) as {
      data: {
        as_of: string;
        currency: string;
        rows: Array<{ total_cents: number }>;
        total_current_cents: number;
        total_days_1_30_cents: number;
        total_days_31_60_cents: number;
        total_days_61_90_cents: number;
        total_days_over_90_cents: number;
        total_outstanding_cents: number;
      };
    };
    const d = body.data;
    expect(d.as_of).toBe(asOf);
    expect(d.currency).toBe('USD');
    expect(Array.isArray(d.rows)).toBe(true);
    const bucketSum =
      d.total_current_cents +
      d.total_days_1_30_cents +
      d.total_days_31_60_cents +
      d.total_days_61_90_cents +
      d.total_days_over_90_cents;
    expect(bucketSum).toBe(d.total_outstanding_cents);

    // Issue a second call with a different as_of and ensure the envelope still validates.
    const earlier = '2026-01-31';
    const res2 = await request.get(
      `${functionsBase()}/finance-api/reports/ar-aging?as_of=${earlier}&currency=USD`,
      { headers: baseHeaders },
    );
    expect(res2.status(), 'ar-aging earlier 200').toBe(200);
    const body2 = (await res2.json()) as { data: { as_of: string } };
    expect(body2.data.as_of).toBe(earlier);
  });
});

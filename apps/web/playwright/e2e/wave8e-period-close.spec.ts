import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 18 — end-to-end period close + trial balance smoke (Wave 8e).
 *
 * Tags: @wave8e @smoke
 *
 * Run time budget: < 60s. API-driven (Edge Function calls). Pins:
 *   1. Bootstrap ephemeral org + COA via seed_org_chart_of_accounts.
 *   2. Create + post a single journal entry (Dr Cash / Cr Revenue).
 *   3. Create a period_close row (status='open').
 *   4. PATCH to status='in_review'.
 *   5. POST /period-closes/:id/close → status='closed' (no draft JEs in range).
 *   6. GET /reports/trial-balance — total debits = total credits, is_balanced=true.
 *
 * Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * VITE_SUPABASE_ANON_KEY. Missing env → skip.
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
  const email = `wave8e-pc-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave8e-pc-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `Wave8e Period Close Smoke`, default_currency_code: 'USD' })
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
  await admin.from('profiles').insert({ user_id, email, display_name: `Wave8e PC` });

  // Seed default COA.
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
  await admin.from('period_close').delete().eq('org_id', fx.org_id);
  await admin.from('journal_entry_lines').delete().eq('org_id', fx.org_id);
  await admin.from('journal_entries').delete().eq('org_id', fx.org_id);
  await admin.from('chart_of_accounts').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@wave8e @smoke Phase 18 period close end-to-end', () => {
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

  test('period_close lifecycle: open → in_review → closed; trial balance balanced', async ({
    request,
  }) => {
    test.setTimeout(60_000);
    const baseHeaders = {
      authorization: `Bearer ${fx.access_token}`,
      apikey: ANON_KEY!,
      'content-type': 'application/json',
    };
    const idemHeaders = () => ({
      ...baseHeaders,
      'idempotency-key': crypto.randomUUID(),
    });

    // ------------------------------------------------------------------- //
    // 1. Look up COA ids we need (1000 Cash + 4000 Revenue).
    // ------------------------------------------------------------------- //
    const admin = adminClient();
    const { data: cashRow, error: cashErr } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('org_id', fx.org_id)
      .eq('account_code', '1000')
      .single();
    if (cashErr || !cashRow) {
      throw new Error(`cash account lookup failed: ${cashErr?.message}`);
    }
    const { data: revRow, error: revErr } = await admin
      .from('chart_of_accounts')
      .select('id')
      .eq('org_id', fx.org_id)
      .eq('account_code', '4000')
      .single();
    if (revErr || !revRow) {
      throw new Error(`revenue account lookup failed: ${revErr?.message}`);
    }

    // ------------------------------------------------------------------- //
    // 2. Create a journal entry (Dr Cash 10000 / Cr Revenue 10000) and
    //    post it. Use a date inside our target period.
    // ------------------------------------------------------------------- //
    const periodStart = '2026-04-01';
    const periodEnd = '2026-04-30';
    const entryDate = '2026-04-15';

    const createJeRes = await request.post(`${functionsBase()}/finance-api/journal-entries`, {
      headers: idemHeaders(),
      data: {
        entry_date: entryDate,
        description: 'Wave 8e smoke seed',
        source_type: 'manual',
        currency_code: 'USD',
        lines: [
          { account_id: cashRow.id, debit_cents: 10000, credit_cents: 0, position: 0 },
          { account_id: revRow.id, debit_cents: 0, credit_cents: 10000, position: 1 },
        ],
      },
    });
    test.skip(
      createJeRes.status() >= 500,
      `finance-api unreachable (HTTP ${createJeRes.status()})`,
    );
    expect(createJeRes.status(), 'create JE 201').toBe(201);
    const je = ((await createJeRes.json()) as { data: { id: string; status: string } }).data;
    expect(je.status).toBe('draft');

    const postJeRes = await request.post(
      `${functionsBase()}/finance-api/journal-entries/${je.id}/post`,
      { headers: idemHeaders(), data: {} },
    );
    expect(postJeRes.status(), 'post JE 200').toBe(200);
    expect(((await postJeRes.json()) as { data: { status: string } }).data.status).toBe('posted');

    // ------------------------------------------------------------------- //
    // 3. Create a period_close row at status='open'.
    // ------------------------------------------------------------------- //
    const createPcRes = await request.post(`${functionsBase()}/finance-api/period-closes`, {
      headers: idemHeaders(),
      data: { period_start: periodStart, period_end: periodEnd, notes: 'April 2026' },
    });
    expect(createPcRes.status(), 'create period_close 201').toBe(201);
    const pc = ((await createPcRes.json()) as {
      data: { id: string; status: string; period_start: string; period_end: string };
    }).data;
    expect(pc.status).toBe('open');

    // ------------------------------------------------------------------- //
    // 4. PATCH to status='in_review'.
    // ------------------------------------------------------------------- //
    const patchRes = await request.patch(
      `${functionsBase()}/finance-api/period-closes/${pc.id}`,
      { headers: idemHeaders(), data: { status: 'in_review' } },
    );
    expect(patchRes.status(), 'PATCH in_review 200').toBe(200);
    const inReview = ((await patchRes.json()) as { data: { status: string } }).data;
    expect(inReview.status).toBe('in_review');

    // ------------------------------------------------------------------- //
    // 5. POST /close — no drafts in range, should succeed and return
    //    the closed row.
    // ------------------------------------------------------------------- //
    const closeRes = await request.post(
      `${functionsBase()}/finance-api/period-closes/${pc.id}/close`,
      { headers: idemHeaders(), data: { notes: 'Ready' } },
    );
    expect(closeRes.status(), 'close 200').toBe(200);
    const closed = ((await closeRes.json()) as {
      data: { status: string; closed_at: string | null };
    }).data;
    expect(closed.status).toBe('closed');
    expect(closed.closed_at).not.toBeNull();

    // ------------------------------------------------------------------- //
    // 6. GET /reports/trial-balance — debits should match credits.
    // ------------------------------------------------------------------- //
    const tbRes = await request.get(
      `${functionsBase()}/finance-api/reports/trial-balance?as_of=${periodEnd}&currency=USD`,
      { headers: baseHeaders },
    );
    expect(tbRes.status(), 'trial-balance 200').toBe(200);
    const tb = ((await tbRes.json()) as {
      data: {
        total_debit_cents: number;
        total_credit_cents: number;
        is_balanced: boolean;
        rows: Array<{ account_code: string; debit_total_cents: number; credit_total_cents: number }>;
      };
    }).data;
    expect(tb.total_debit_cents, 'TB debits').toBe(10000);
    expect(tb.total_credit_cents, 'TB credits').toBe(10000);
    expect(tb.is_balanced).toBe(true);

    // Spot check: the cash account row has debit 10000 / credit 0.
    const cashTbRow = tb.rows.find((r) => r.account_code === '1000');
    expect(cashTbRow?.debit_total_cents).toBe(10000);
    expect(cashTbRow?.credit_total_cents).toBe(0);
  });
});

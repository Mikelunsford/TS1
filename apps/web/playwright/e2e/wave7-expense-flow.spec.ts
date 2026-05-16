import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 11 — end-to-end expense smoke (Wave 7).
 *
 * Tags: @wave7 @smoke
 *
 * Run time budget: < 60s. API-driven (Edge Function calls). Pins the
 * canonical expense lifecycle:
 *
 *   draft → submitted → approved → paid
 *
 * and the rejection-resubmission loop (submitted → rejected → submitted).
 *
 * Sequence:
 *   1.  Sign in as org_owner (ephemeral org via service-role bootstrap).
 *   2.  Create an expense_category.
 *   3.  Create an expense with amount_cents + tax_cents; assert the BIU
 *       trigger from migration 0058 set total_cents := amount + tax.
 *   4.  Submit → reject (with reason) → assert status='rejected'.
 *   5.  Re-submit (rejected → submitted resubmission path); approve.
 *   6.  Pay → assert status='paid', paid_at stamped.
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
  const email = `wave7-exp-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave7-exp-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `Wave7 Expense Smoke`, default_currency_code: 'USD' })
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
  await admin.from('profiles').insert({ user_id, email, display_name: `Wave7 Expense` });

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
  await admin.from('expenses').delete().eq('org_id', fx.org_id);
  await admin.from('expense_categories').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@wave7 @smoke Phase 11 expense end-to-end', () => {
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

  test('expense lifecycle: submit → reject → resubmit → approve → pay', async ({ request }) => {
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

    // --------------------------------------------------------------------- //
    // 1. Create an expense_category.
    // --------------------------------------------------------------------- //
    const createCategoryRes = await request.post(
      `${functionsBase()}/finance-api/expense-categories`,
      {
        headers: idemHeaders(),
        data: { code: 'TRAVEL', label: 'Travel & Entertainment' },
      },
    );
    test.skip(
      createCategoryRes.status() >= 500,
      `finance-api unreachable (HTTP ${createCategoryRes.status()})`,
    );
    expect(createCategoryRes.status(), 'create category 201').toBe(201);
    const category = ((await createCategoryRes.json()) as { data: { id: string; code: string } })
      .data;
    expect(category.code).toBe('TRAVEL');

    // --------------------------------------------------------------------- //
    // 2. Create an expense. Pass amount + tax separately; trigger sets total.
    //    amount=25000 + tax=2000 → total expected 27000.
    // --------------------------------------------------------------------- //
    const createExpenseRes = await request.post(`${functionsBase()}/finance-api/expenses`, {
      headers: idemHeaders(),
      data: {
        category_id: category.id,
        spent_at: new Date().toISOString().slice(0, 10),
        description: 'Conference travel',
        currency_code: 'USD',
        amount_cents: 25000,
        tax_cents: 2000,
      },
    });
    expect(createExpenseRes.status(), 'create expense 201').toBe(201);
    const expense = ((await createExpenseRes.json()) as {
      data: {
        id: string;
        status: string;
        amount_cents: number;
        tax_cents: number;
        total_cents: number;
        paid_at: string | null;
      };
    }).data;
    expect(expense.status).toBe('draft');
    expect(expense.amount_cents).toBe(25000);
    expect(expense.tax_cents).toBe(2000);
    // BIU trigger from migration 0058: total := amount + tax.
    expect(expense.total_cents, 'total set by BIU trigger').toBe(27000);
    expect(expense.paid_at).toBeNull();

    // --------------------------------------------------------------------- //
    // 3. Submit → reject (with reason).
    // --------------------------------------------------------------------- //
    const submit1Res = await request.post(
      `${functionsBase()}/finance-api/expenses/${expense.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submit1Res.status(), 'submit 200').toBe(200);
    expect(((await submit1Res.json()) as { data: { status: string } }).data.status).toBe(
      'submitted',
    );

    const rejectRes = await request.post(
      `${functionsBase()}/finance-api/expenses/${expense.id}/reject`,
      {
        headers: idemHeaders(),
        data: { reason: 'missing receipt' },
      },
    );
    expect(rejectRes.status(), 'reject 200').toBe(200);
    const rejected = ((await rejectRes.json()) as { data: { status: string } }).data;
    expect(rejected.status).toBe('rejected');

    // --------------------------------------------------------------------- //
    // 4. Resubmit (rejected → submitted), then approve.
    //    The matrix legally allows rejected → submitted as the resubmission
    //    path — pins the constitutional rule for expense.
    // --------------------------------------------------------------------- //
    const submit2Res = await request.post(
      `${functionsBase()}/finance-api/expenses/${expense.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submit2Res.status(), 'resubmit 200').toBe(200);
    expect(((await submit2Res.json()) as { data: { status: string } }).data.status).toBe(
      'submitted',
    );

    const approveRes = await request.post(
      `${functionsBase()}/finance-api/expenses/${expense.id}/approve`,
      { headers: idemHeaders(), data: {} },
    );
    expect(approveRes.status(), 'approve 200').toBe(200);
    expect(((await approveRes.json()) as { data: { status: string } }).data.status).toBe(
      'approved',
    );

    // --------------------------------------------------------------------- //
    // 5. Pay → status='paid', paid_at set.
    // --------------------------------------------------------------------- //
    const payRes = await request.post(
      `${functionsBase()}/finance-api/expenses/${expense.id}/pay`,
      { headers: idemHeaders(), data: {} },
    );
    expect(payRes.status(), 'pay 200').toBe(200);
    const paid = ((await payRes.json()) as {
      data: { status: string; paid_at: string | null; total_cents: number };
    }).data;
    expect(paid.status).toBe('paid');
    expect(paid.paid_at, 'paid_at stamped').not.toBeNull();
    expect(paid.total_cents, 'total preserved through lifecycle').toBe(27000);
  });
});

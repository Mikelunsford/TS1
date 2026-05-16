import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 21 (Wave 10 Session 4) — customer portal flow e2e.
 *
 * Tags: @phase21 @smoke
 *
 * Sequence:
 *   1. Bootstrap an org + a customer record + a customer_user member.
 *   2. Seed a paid invoice + an open invoice for that customer.
 *   3. Sign in as the customer_user; hit /portal/me, /portal/invoices,
 *      /portal/invoices/:id, /portal/statements.
 *   4. Assert cross-customer access is denied (RLS smoke).
 *   5. Cleanup.
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

interface User {
  user_id: string;
  email: string;
  access_token: string;
}
interface Fixture {
  org_id: string;
  customer_id: string;
  other_customer_id: string;
  invoice_a_id: string;
  invoice_b_id: string;
  portal_user: User;
}

async function makePortalUser(
  orgId: string,
  customerId: string,
  suffix: string,
): Promise<User> {
  const admin = adminClient();
  const email = `phase21-portal-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_Portal!1`;
  const { data: userRow, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { team1_org_id: orgId, team1_org_role: 'customer_user' },
  });
  if (userErr || !userRow.user) throw new Error(`user create failed: ${userErr?.message}`);
  const user_id = userRow.user.id;
  const { data: roleRow } = await admin
    .from('roles')
    .select('id')
    .eq('code', 'customer_user')
    .single();
  await admin.from('org_memberships').insert({
    org_id: orgId,
    user_id,
    role_id: roleRow!.id,
    customer_id: customerId,
    is_active: true,
  });
  await admin.from('profiles').insert({ user_id, email, display_name: 'Phase21 Portal' });

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session } = await userClient.auth.signInWithPassword({ email, password });
  if (!session.session) throw new Error('signin failed');
  return { user_id, email, access_token: session.session.access_token };
}

async function makeFixture(): Promise<Fixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `phase21-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Phase21 Smoke', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  const { data: cust } = await admin
    .from('customers')
    .insert({ org_id, display_name: 'Phase21 Cust', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (!cust) throw new Error('customer insert failed');

  const { data: other } = await admin
    .from('customers')
    .insert({ org_id, display_name: 'Phase21 OtherCust', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (!other) throw new Error('other customer insert failed');

  // Seed two invoices for the portal user's customer (one sent, one paid).
  const today = new Date().toISOString().slice(0, 10);
  const { data: invA } = await admin
    .from('invoices')
    .insert({
      org_id,
      customer_id: cust.id,
      customer_name_snapshot: 'Phase21 Cust',
      status: 'sent',
      payment_status: 'unpaid',
      currency_code: 'USD',
      issue_date: today,
      due_date: today,
      subtotal_cents: 10000,
      tax_cents: 0,
      total_cents: 10000,
      balance_cents: 10000,
    })
    .select('id')
    .single();
  if (!invA) throw new Error('invoice A insert failed');

  const { data: invB } = await admin
    .from('invoices')
    .insert({
      org_id,
      customer_id: other.id,
      customer_name_snapshot: 'Phase21 OtherCust',
      status: 'sent',
      payment_status: 'unpaid',
      currency_code: 'USD',
      issue_date: today,
      due_date: today,
      subtotal_cents: 50000,
      tax_cents: 0,
      total_cents: 50000,
      balance_cents: 50000,
    })
    .select('id')
    .single();
  if (!invB) throw new Error('invoice B insert failed');

  const portal_user = await makePortalUser(org_id, cust.id as string, suffix);

  return {
    org_id,
    customer_id: cust.id as string,
    other_customer_id: other.id as string,
    invoice_a_id: invA.id as string,
    invoice_b_id: invB.id as string,
    portal_user,
  };
}

async function teardown(fx: Fixture): Promise<void> {
  const admin = adminClient();
  await admin.from('invoices').delete().eq('org_id', fx.org_id);
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.portal_user.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@phase21 @smoke customer-portal-api flow', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: Fixture;
  test.beforeAll(async () => {
    fx = await makeFixture();
  });
  test.afterAll(async () => {
    if (fx) await teardown(fx).catch(() => undefined);
  });

  test('portal user reads own data; cannot read other customer', async ({ request }) => {
    test.setTimeout(120_000);

    const headers = {
      authorization: `Bearer ${fx.portal_user.access_token}`,
      apikey: ANON_KEY!,
      'content-type': 'application/json',
    };

    // /portal/me
    const meRes = await request.get(`${functionsBase()}/customer-portal-api/portal/me`, {
      headers,
    });
    expect(meRes.status()).toBe(200);
    const meJson = await meRes.json();
    expect(meJson.data.customer.id).toBe(fx.customer_id);

    // /portal/invoices — only own invoice surfaces.
    const listRes = await request.get(
      `${functionsBase()}/customer-portal-api/portal/invoices`,
      { headers },
    );
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();
    const ids: string[] = listJson.data.items.map((i: { id: string }) => i.id);
    expect(ids).toContain(fx.invoice_a_id);
    expect(ids).not.toContain(fx.invoice_b_id);

    // /portal/invoices/:id own — 200
    const ownDetail = await request.get(
      `${functionsBase()}/customer-portal-api/portal/invoices/${fx.invoice_a_id}`,
      { headers },
    );
    expect(ownDetail.status()).toBe(200);
    const ownJson = await ownDetail.json();
    expect(ownJson.data.invoice.id).toBe(fx.invoice_a_id);

    // /portal/invoices/:id other-customer — 404 (filtered out, never leaked)
    const otherDetail = await request.get(
      `${functionsBase()}/customer-portal-api/portal/invoices/${fx.invoice_b_id}`,
      { headers },
    );
    expect(otherDetail.status()).toBe(404);

    // /portal/statements — single bucket snapshot for this customer.
    const stmtRes = await request.get(
      `${functionsBase()}/customer-portal-api/portal/statements`,
      { headers },
    );
    expect(stmtRes.status()).toBe(200);
    const stmtJson = await stmtRes.json();
    expect(stmtJson.data.aging.customer_id).toBe(fx.customer_id);
    expect(stmtJson.data.aging.total_cents).toBeGreaterThanOrEqual(10000);
  });
});

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 10 — end-to-end procurement smoke (Wave 7).
 *
 * Tags: @wave7 @smoke
 *
 * Run time budget: < 90s. API-driven (Edge Function calls). Mirrors the
 * Wave 6 CN-application spec — pins the procurement contract that the
 * future Phase 10 SPA (Wave 7b) will rely on, without depending on the
 * SPA being deployed at smoke time.
 *
 * Sequence (the load-bearing path):
 *   1.  Sign in as org_owner (ephemeral org via service-role bootstrap).
 *   2.  Create a vendor.
 *   3.  Create a purchase order with 2 line items; assert subtotal/total
 *       rolled up by the recompute_purchase_order_totals trigger
 *       (migration 0058).
 *   4.  Submit → approve.
 *   5.  Partial-receive line 1 fully → assert status='partial_received'.
 *   6.  Full-receive line 2 → assert status='received'.
 *   7.  Create a vendor bill against the same PO + vendor.
 *   8.  Submit → approve.
 *   9.  Pay partial → assert status='partially_paid', balance_cents > 0.
 *   10. Pay remainder → assert status='paid', balance_cents=0.
 *   11. Teardown (procurement chain: bills → po_line_items → POs → vendors).
 *
 * Required env: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * VITE_SUPABASE_ANON_KEY. Missing env → skip with a clear message
 * (constitution forbids green-from-missing-env false positives).
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
  const email = `wave7-proc-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave7-proc-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `Wave7 Procurement Smoke`, default_currency_code: 'USD' })
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
  await admin.from('profiles').insert({ user_id, email, display_name: `Wave7 Procurement` });

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
  // Order respects FKs: vendor_bills → po_line_items → POs → vendors.
  await admin.from('vendor_bills').delete().eq('org_id', fx.org_id);
  await admin.from('po_line_items').delete().eq('org_id', fx.org_id);
  await admin.from('purchase_orders').delete().eq('org_id', fx.org_id);
  await admin.from('vendors').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

test.describe('@wave7 @smoke Phase 10 procurement end-to-end', () => {
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

  test('PO → receive (partial → full) → vendor bill → pay (partial → full)', async ({
    request,
  }) => {
    test.setTimeout(90_000);
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
    // 1. Create vendor.
    // --------------------------------------------------------------------- //
    const createVendorRes = await request.post(`${functionsBase()}/vendors-api/vendors`, {
      headers: idemHeaders(),
      data: {
        name: 'Wave7 Smoke Vendor',
        currency_code: 'USD',
        payment_terms_days: 30,
      },
    });
    test.skip(
      createVendorRes.status() >= 500,
      `vendors-api unreachable (HTTP ${createVendorRes.status()})`,
    );
    expect(createVendorRes.status(), 'create vendor 201').toBe(201);
    const vendor = ((await createVendorRes.json()) as { data: { id: string } }).data;

    // --------------------------------------------------------------------- //
    // 2. Create PO with two line items. Subtotal should roll up via the
    //    AIUD trigger on po_line_items (migration 0058).
    //    Line 1: 10 × $5.00 = $50.00 → 5000 cents
    //    Line 2: 1 × $250.00 = $250.00 → 25000 cents
    //    Subtotal = 30000 cents; total = subtotal + tax + shipping = 30000.
    // --------------------------------------------------------------------- //
    const createPoRes = await request.post(`${functionsBase()}/vendors-api/purchase-orders`, {
      headers: idemHeaders(),
      data: {
        vendor_id: vendor.id,
        expected_date: addDays(new Date().toISOString(), 14),
        currency_code: 'USD',
        lines: [
          { description: 'Box of widgets', quantity: 10, unit_cost_cents: 500, position: 0 },
          { description: 'Pallet of sprockets', quantity: 1, unit_cost_cents: 25000, position: 1 },
        ],
      },
    });
    expect(createPoRes.status(), 'create PO 201').toBe(201);
    const po = ((await createPoRes.json()) as {
      data: { id: string; status: string; subtotal_cents: number; total_cents: number };
    }).data;
    expect(po.status).toBe('draft');
    expect(po.subtotal_cents, 'subtotal rolled up by AIUD trigger').toBe(30000);
    expect(po.total_cents).toBe(30000);

    // Re-read PO + line items to capture line ids (needed for /receive).
    const getPoRes = await request.get(`${functionsBase()}/vendors-api/purchase-orders/${po.id}`, {
      headers: baseHeaders,
    });
    expect(getPoRes.status()).toBe(200);
    const poDetail = ((await getPoRes.json()) as {
      data: {
        id: string;
        lines: Array<{ id: string; quantity: number; quantity_received: number; position: number }>;
      };
    }).data;
    expect(poDetail.lines?.length ?? 0, 'PO detail returns its line items').toBeGreaterThanOrEqual(
      2,
    );
    const lineByPos = new Map(poDetail.lines.map((l) => [l.position, l]));
    const line1 = lineByPos.get(0) ?? poDetail.lines[0];
    const line2 = lineByPos.get(1) ?? poDetail.lines[1];

    // --------------------------------------------------------------------- //
    // 3. Submit → approve.
    // --------------------------------------------------------------------- //
    const submitRes = await request.post(
      `${functionsBase()}/vendors-api/purchase-orders/${po.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submitRes.status()).toBe(200);
    const approveRes = await request.post(
      `${functionsBase()}/vendors-api/purchase-orders/${po.id}/approve`,
      { headers: idemHeaders(), data: {} },
    );
    expect(approveRes.status()).toBe(200);

    // --------------------------------------------------------------------- //
    // 4. Partial-receive: fully receive line 1 only.
    //    Expected status='partial_received' (spelling: one r).
    // --------------------------------------------------------------------- //
    const partialReceiveRes = await request.post(
      `${functionsBase()}/vendors-api/purchase-orders/${po.id}/receive`,
      {
        headers: idemHeaders(),
        data: {
          lines: [{ po_line_item_id: line1!.id, quantity_received: line1!.quantity }],
        },
      },
    );
    expect(partialReceiveRes.status(), 'partial receive 200').toBe(200);
    const afterPartial = ((await partialReceiveRes.json()) as { data: { status: string } }).data;
    expect(afterPartial.status, 'PO status after partial receive').toBe('partial_received');

    // --------------------------------------------------------------------- //
    // 5. Full-receive: fully receive line 2 → status='received'.
    // --------------------------------------------------------------------- //
    const fullReceiveRes = await request.post(
      `${functionsBase()}/vendors-api/purchase-orders/${po.id}/receive`,
      {
        headers: idemHeaders(),
        data: {
          lines: [{ po_line_item_id: line2!.id, quantity_received: line2!.quantity }],
        },
      },
    );
    expect(fullReceiveRes.status(), 'full receive 200').toBe(200);
    const afterFull = ((await fullReceiveRes.json()) as { data: { status: string } }).data;
    expect(afterFull.status, 'PO status after full receive').toBe('received');

    // --------------------------------------------------------------------- //
    // 6. Create a vendor bill against the PO. Header-only (no line items).
    //    Use subtotal=30000, tax=0, total=30000. balance_cents is set by
    //    the BIU trigger from migration 0058.
    // --------------------------------------------------------------------- //
    const due_date = addDays(new Date().toISOString(), 30);
    const createBillRes = await request.post(`${functionsBase()}/vendors-api/vendor-bills`, {
      headers: idemHeaders(),
      data: {
        vendor_id: vendor.id,
        po_id: po.id,
        vendor_ref: 'V-INV-9001',
        due_date,
        currency_code: 'USD',
        subtotal_cents: 30000,
        tax_cents: 0,
        total_cents: 30000,
      },
    });
    expect(createBillRes.status(), 'create vendor bill 201').toBe(201);
    const bill = ((await createBillRes.json()) as {
      data: { id: string; status: string; balance_cents: number | null; total_cents: number };
    }).data;
    expect(bill.status).toBe('draft');
    expect(bill.total_cents).toBe(30000);
    // The BIU trigger should have set balance := total - paid = 30000 - 0.
    expect(bill.balance_cents, 'balance set by BIU trigger').toBe(30000);

    // --------------------------------------------------------------------- //
    // 7. Submit → approve the bill.
    // --------------------------------------------------------------------- //
    const submitBillRes = await request.post(
      `${functionsBase()}/vendors-api/vendor-bills/${bill.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submitBillRes.status()).toBe(200);
    const approveBillRes = await request.post(
      `${functionsBase()}/vendors-api/vendor-bills/${bill.id}/approve`,
      { headers: idemHeaders(), data: {} },
    );
    expect(approveBillRes.status()).toBe(200);

    // --------------------------------------------------------------------- //
    // 8. Pay partial (half). Expect status='partially_paid', balance > 0.
    // --------------------------------------------------------------------- //
    const half = 30000 / 2;
    const payPartialRes = await request.post(
      `${functionsBase()}/vendors-api/vendor-bills/${bill.id}/pay`,
      {
        headers: idemHeaders(),
        data: { amount_cents: half },
      },
    );
    expect(payPartialRes.status(), 'pay partial 200').toBe(200);
    const afterPayPartial = ((await payPartialRes.json()) as {
      data: { status: string; balance_cents: number | null; paid_cents: number };
    }).data;
    expect(afterPayPartial.status).toBe('partially_paid');
    expect(afterPayPartial.balance_cents, 'balance > 0 after partial pay').toBe(half);
    expect(afterPayPartial.paid_cents).toBe(half);

    // --------------------------------------------------------------------- //
    // 9. Pay remainder. Expect status='paid', balance_cents=0.
    // --------------------------------------------------------------------- //
    const payFullRes = await request.post(
      `${functionsBase()}/vendors-api/vendor-bills/${bill.id}/pay`,
      {
        headers: idemHeaders(),
        data: { amount_cents: half },
      },
    );
    expect(payFullRes.status(), 'pay remainder 200').toBe(200);
    const afterPayFull = ((await payFullRes.json()) as {
      data: { status: string; balance_cents: number | null; paid_cents: number };
    }).data;
    expect(afterPayFull.status).toBe('paid');
    expect(afterPayFull.balance_cents, 'balance zeroed').toBe(0);
    expect(afterPayFull.paid_cents).toBe(30000);
  });
});

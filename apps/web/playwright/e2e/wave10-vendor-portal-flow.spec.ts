import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 22 (Wave 10 Session 4) — vendor-portal-api e2e.
 *
 * Tags: @phase22 @smoke
 *
 * Sequence:
 *   1. Bootstrap a fresh org with one vendor + one vendor_user
 *      membership + a sample PO + a sample vendor_bill.
 *   2. GET /vendor-portal/me — expect the right vendor profile.
 *   3. GET /vendor-portal/purchase-orders — expect 1 row.
 *   4. POST /vendor-portal/purchase-orders/:id/acknowledge — expect 200.
 *   5. GET /vendor-portal/vendor-bills — expect 1 row.
 *   6. RLS cross-vendor probe: create vendor B + PO, assert vendor A's
 *      JWT cannot see vendor B's PO via the same endpoint.
 *   7. Cleanup.
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

interface VendorActor {
  user_id: string;
  email: string;
  access_token: string;
  vendor_id: string;
}

interface Fixture {
  org_id: string;
  a: VendorActor;
  b: VendorActor;
  po_a_id: string;
  po_b_id: string;
  vb_a_id: string;
}

async function makeVendor(
  admin: SupabaseClient,
  orgId: string,
  label: string,
  suffix: string,
): Promise<VendorActor> {
  const { data: v } = await admin
    .from('vendors')
    .insert({ org_id: orgId, name: `${label} Vendor ${suffix}`, currency_code: 'USD' })
    .select('id')
    .single();
  const vendor_id = v!.id as string;

  const email = `phase22-${label.toLowerCase()}-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${label}!1`;
  const { data: userRow } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { team1_org_id: orgId, team1_org_role: 'vendor_user' },
  });
  const user_id = userRow!.user!.id;

  const { data: roleRow } = await admin
    .from('roles')
    .select('id')
    .eq('code', 'vendor_user')
    .single();
  await admin.from('org_memberships').insert({
    org_id: orgId,
    user_id,
    role_id: roleRow!.id,
    vendor_id,
    is_active: true,
  });
  await admin.from('profiles').insert({ user_id, email, display_name: `Phase22 ${label}` });

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session } = await userClient.auth.signInWithPassword({ email, password });
  return { user_id, email, access_token: session.session!.access_token, vendor_id };
}

async function makeFixture(): Promise<Fixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `phase22-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Phase22 Smoke', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;
  await admin.rpc('seed_org_defaults', { p_org_id: org_id });

  const a = await makeVendor(admin, org_id, 'A', suffix);
  const b = await makeVendor(admin, org_id, 'B', suffix);

  const { data: poA } = await admin
    .from('purchase_orders')
    .insert({
      org_id,
      vendor_id: a.vendor_id,
      status: 'approved',
      issue_date: '2026-05-01',
      currency_code: 'USD',
      subtotal_cents: 10000,
      total_cents: 10000,
    })
    .select('id')
    .single();
  const po_a_id = poA!.id as string;

  const { data: poB } = await admin
    .from('purchase_orders')
    .insert({
      org_id,
      vendor_id: b.vendor_id,
      status: 'approved',
      issue_date: '2026-05-01',
      currency_code: 'USD',
      subtotal_cents: 20000,
      total_cents: 20000,
    })
    .select('id')
    .single();
  const po_b_id = poB!.id as string;

  const { data: vbA } = await admin
    .from('vendor_bills')
    .insert({
      org_id,
      vendor_id: a.vendor_id,
      vendor_ref: 'INV-A-1',
      status: 'pending',
      issue_date: '2026-05-02',
      due_date: '2026-06-01',
      currency_code: 'USD',
      subtotal_cents: 10000,
      total_cents: 10000,
    })
    .select('id')
    .single();
  const vb_a_id = vbA!.id as string;

  return { org_id, a, b, po_a_id, po_b_id, vb_a_id };
}

async function teardown(fx: Fixture): Promise<void> {
  const admin = adminClient();
  await admin.from('vendor_bills').delete().eq('org_id', fx.org_id);
  await admin.from('purchase_orders').delete().eq('org_id', fx.org_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('vendors').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.a.user_id).catch(() => undefined);
  await admin.auth.admin.deleteUser(fx.b.user_id).catch(() => undefined);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@phase22 @smoke vendor-portal-api', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: Fixture;
  test.beforeAll(async () => {
    fx = await makeFixture();
  });
  test.afterAll(async () => {
    if (fx) await teardown(fx);
  });

  test('GET /vendor-portal/me returns the calling vendor', async ({ request }) => {
    const res = await request.get(`${functionsBase()}/vendor-portal-api/me`, {
      headers: {
        authorization: `Bearer ${fx.a.access_token}`,
        apikey: ANON_KEY!,
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.vendor.id).toBe(fx.a.vendor_id);
    expect(body.data.role).toBe('vendor_user');
  });

  test('vendor A only sees their own PO', async ({ request }) => {
    const res = await request.get(`${functionsBase()}/vendor-portal-api/purchase-orders`, {
      headers: { authorization: `Bearer ${fx.a.access_token}`, apikey: ANON_KEY! },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids = (body.data.items as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(fx.po_a_id);
    expect(ids).not.toContain(fx.po_b_id);
  });

  test('vendor A cannot read vendor B PO via detail GET (RLS denies)', async ({ request }) => {
    const res = await request.get(
      `${functionsBase()}/vendor-portal-api/purchase-orders/${fx.po_b_id}`,
      { headers: { authorization: `Bearer ${fx.a.access_token}`, apikey: ANON_KEY! } },
    );
    // 404 (we explicitly filter by vendor_id in the handler before
    // RLS even matters).
    expect(res.status()).toBe(404);
  });

  test('POST /purchase-orders/:id/acknowledge returns 200', async ({ request }) => {
    const res = await request.post(
      `${functionsBase()}/vendor-portal-api/purchase-orders/${fx.po_a_id}/acknowledge`,
      {
        headers: {
          authorization: `Bearer ${fx.a.access_token}`,
          apikey: ANON_KEY!,
          'idempotency-key': crypto.randomUUID(),
        },
        data: {},
      },
    );
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.id).toBe(fx.po_a_id);
    expect(typeof body.data.acknowledged_at).toBe('string');
  });

  test('GET /vendor-bills only shows A bills', async ({ request }) => {
    const res = await request.get(`${functionsBase()}/vendor-portal-api/vendor-bills`, {
      headers: { authorization: `Bearer ${fx.a.access_token}`, apikey: ANON_KEY! },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    const ids = (body.data.items as Array<{ id: string }>).map((b) => b.id);
    expect(ids).toContain(fx.vb_a_id);
  });
});

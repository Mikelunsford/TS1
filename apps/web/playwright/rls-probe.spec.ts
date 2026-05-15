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

/**
 * Per-fixture uniquifier used to disambiguate row numbers / names within a
 * single Playwright run. The org_id slice is unique per fixture; the
 * timestamp+random suffix keeps it unique even if the same fixture seeds
 * multiple rows in the same table.
 */
function uniquifier(fx: OrgFixture, label: string): string {
  return `${label}-${fx.org_id.slice(0, 8)}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/** Seed a lead row owned by `fx.org_id`. Returns the lead id. */
async function seedLead(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'lead');
  const { data, error } = await admin
    .from('leads')
    .insert({
      org_id: fx.org_id,
      lead_number: `L-${suffix}`,
      display_name: `Lead-${suffix}`,
      status: 'new',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`lead seed failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Seed an opportunity (requires a customer first since opportunities.customer_id
 * is NOT NULL). Returns `{ customer_id, opportunity_id }`.
 */
async function seedOpportunity(
  fx: OrgFixture,
): Promise<{ customer_id: string; opportunity_id: string }> {
  const admin = adminClient();
  const customer_id = await seedCustomer(fx);
  const suffix = uniquifier(fx, 'opp');
  const { data, error } = await admin
    .from('opportunities')
    .insert({
      org_id: fx.org_id,
      customer_id,
      opportunity_number: `O-${suffix}`,
      name: `Opportunity-${suffix}`,
      stage: 'prospect',
      amount_cents: 0,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`opportunity seed failed: ${error?.message}`);
  return { customer_id, opportunity_id: data.id as string };
}

/**
 * Seed a contact (requires a customer first since contacts.customer_id is
 * NOT NULL). Returns `{ customer_id, contact_id }`.
 */
async function seedContact(
  fx: OrgFixture,
): Promise<{ customer_id: string; contact_id: string }> {
  const admin = adminClient();
  const customer_id = await seedCustomer(fx);
  const suffix = uniquifier(fx, 'ct');
  const { data, error } = await admin
    .from('contacts')
    .insert({
      org_id: fx.org_id,
      customer_id,
      first_name: `Contact`,
      last_name: suffix,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`contact seed failed: ${error?.message}`);
  return { customer_id, contact_id: data.id as string };
}

// =========================================================================
// Wave 3 seed helpers — sales-chassis tenant-scoped tables.
// =========================================================================

/** Seed an item (formerly pricing_menu; renamed in 0049). Returns the id. */
async function seedItem(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'itm');
  // item_code is GLOBALLY unique (legacy constraint from 0001_init.sql), not
  // org-scoped. Use the per-fixture uniquifier to avoid collisions across
  // parallel test runs.
  const { data, error } = await admin
    .from('items')
    .insert({
      org_id: fx.org_id,
      item_code: `RLS-${suffix}`,
      description: `RLS Probe Item ${suffix}`,
      item_kind: 'material',
      unit_price_cents: 10000,
      unit_cost_cents: 8000,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`item seed failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Seed a tax row. `is_default=false` so we don't collide with the
 * per-org partial unique index `uq_taxes_default_per_org WHERE is_default`
 * — the 0049 seed already inserted a default TAX-0 row per org.
 */
async function seedTax(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'tax');
  const { data, error } = await admin
    .from('taxes')
    .insert({
      org_id: fx.org_id,
      code: `RLS-${suffix}`,
      label: `RLS Probe Tax ${suffix}`,
      rate: 0.05,
      is_active: true,
      is_default: false,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`tax seed failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Seed a payment_method row. `is_default=false` to avoid the per-org
 * partial unique index on `(org_id) WHERE is_default`.
 */
async function seedPaymentMethod(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'pm');
  const { data, error } = await admin
    .from('payment_methods')
    .insert({
      org_id: fx.org_id,
      code: `rls-${suffix}`,
      label: `RLS Probe Method ${suffix}`,
      is_active: true,
      is_default: false,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`payment_method seed failed: ${error?.message}`);
  return data.id as string;
}

/** Seed an item_category row owned by `fx.org_id`. */
async function seedItemCategory(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'cat');
  const { data, error } = await admin
    .from('item_categories')
    .insert({
      org_id: fx.org_id,
      code: `rls-${suffix}`,
      label: `RLS Probe Cat ${suffix}`,
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`item_category seed failed: ${error?.message}`);
  return data.id as string;
}

/** Seed a unit row owned by `fx.org_id`. */
async function seedUnit(fx: OrgFixture): Promise<string> {
  const admin = adminClient();
  const suffix = uniquifier(fx, 'un');
  const { data, error } = await admin
    .from('units')
    .insert({
      org_id: fx.org_id,
      code: `rls-${suffix}`,
      label: `RLS Probe Unit ${suffix}`,
      family: 'count',
      is_active: true,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`unit seed failed: ${error?.message}`);
  return data.id as string;
}

/**
 * Seed an exchange_rate row.
 *
 * NOTE: `public.exchange_rates` has NO `org_id` column — it is GLOBAL reference
 * data (see migration 0033). Its SELECT policy is unconditional (`qual: true`).
 * Cross-tenant filtering does not apply here; this seeder is used only by the
 * single positive-control test ("any signed-in caller sees the same rows").
 * We pick a unique `(base_code, quote_code, as_of)` tuple per invocation to
 * avoid the unique constraint colliding across parallel test runs.
 */
async function seedExchangeRate(): Promise<string> {
  const admin = adminClient();
  // The `as_of` column is a DATE; collisions in (base_code, quote_code, as_of)
  // are 409s. The unique-date trick: pick a date so far in the future that
  // production data never reaches it. We shift the year forward by a random
  // 100..999 to keep the date valid (year 2100..2999, comfortably valid).
  const yearOffset = 100 + Math.floor(Math.random() * 900);
  const asOf = `${2126 + yearOffset}-${String(1 + Math.floor(Math.random() * 12)).padStart(2, '0')}-${String(1 + Math.floor(Math.random() * 28)).padStart(2, '0')}`;
  const { data, error } = await admin
    .from('exchange_rates')
    .insert({
      base_code: 'USD',
      quote_code: 'EUR',
      rate: 0.85 + Math.random() * 0.1,
      as_of: asOf,
      source: 'rls-probe',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`exchange_rate seed failed: ${error?.message}`);
  return data.id as string;
}

/** Teardown: delete user (cascades memberships) + delete org row. */
async function teardown(fx: OrgFixture): Promise<void> {
  const admin = adminClient();
  // Order: leaf children first, then customers, then membership/org rows.
  // The opportunity table references customers (ON DELETE RESTRICT), so
  // delete opportunities and leads before customers.
  await admin.from('opportunities').delete().eq('org_id', fx.org_id);
  await admin.from('leads').delete().eq('org_id', fx.org_id);
  await admin.from('contacts').delete().eq('org_id', fx.org_id);
  await admin.from('activities').delete().eq('org_id', fx.org_id);
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  // Wave 3 sales-chassis tenant-scoped tables. items.tax_id, items.unit_id,
  // items.category_id reference taxes/units/item_categories so delete items
  // first (they ON DELETE SET NULL but explicit ordering is cheaper than
  // discovering edge cases). taxes.org_id and payment_methods.org_id are
  // ON DELETE RESTRICT, so delete those rows before the org row.
  await admin.from('items').delete().eq('org_id', fx.org_id);
  await admin.from('item_categories').delete().eq('org_id', fx.org_id);
  await admin.from('units').delete().eq('org_id', fx.org_id);
  await admin.from('taxes').delete().eq('org_id', fx.org_id);
  await admin.from('payment_methods').delete().eq('org_id', fx.org_id);
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

  test('user B cannot read user A lead via PostgREST', async ({ request }) => {
    const leadA = await seedLead(orgA);
    try {
      const res = await request.get(
        `${SUPABASE_URL!}/rest/v1/leads?id=eq.${leadA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgB.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A leads').toHaveLength(0);

      // Positive control: A reads its own lead.
      const ownRes = await request.get(
        `${SUPABASE_URL!}/rest/v1/leads?id=eq.${leadA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgA.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own lead').toBe(1);
      expect(ownBody[0]!.id).toBe(leadA);
    } finally {
      await adminClient().from('leads').delete().eq('id', leadA);
    }
  });

  test('user B cannot read user A opportunity via PostgREST', async ({ request }) => {
    const { customer_id, opportunity_id } = await seedOpportunity(orgA);
    try {
      const res = await request.get(
        `${SUPABASE_URL!}/rest/v1/opportunities?id=eq.${opportunity_id}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgB.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A opportunities').toHaveLength(0);

      const ownRes = await request.get(
        `${SUPABASE_URL!}/rest/v1/opportunities?id=eq.${opportunity_id}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgA.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own opportunity').toBe(1);
      expect(ownBody[0]!.id).toBe(opportunity_id);
    } finally {
      const admin = adminClient();
      await admin.from('opportunities').delete().eq('id', opportunity_id);
      await admin.from('customers').delete().eq('id', customer_id);
    }
  });

  test('user B cannot read user A contact via PostgREST', async ({ request }) => {
    const { customer_id, contact_id } = await seedContact(orgA);
    try {
      const res = await request.get(
        `${SUPABASE_URL!}/rest/v1/contacts?id=eq.${contact_id}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgB.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A contacts').toHaveLength(0);

      const ownRes = await request.get(
        `${SUPABASE_URL!}/rest/v1/contacts?id=eq.${contact_id}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgA.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own contact').toBe(1);
      expect(ownBody[0]!.id).toBe(contact_id);
    } finally {
      const admin = adminClient();
      await admin.from('contacts').delete().eq('id', contact_id);
      await admin.from('customers').delete().eq('id', customer_id);
    }
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

  // =========================================================================
  // Wave 3 sales-chassis cross-tenant matrix.
  // For each org-scoped finance/inventory table: orgA seeds a row; orgB's JWT
  // sees zero. Positive control: orgA sees its own row.
  // =========================================================================

  test('user B cannot read user A item via PostgREST', async ({ request }) => {
    const itemA = await seedItem(orgA);
    try {
      const res = await request.get(`${SUPABASE_URL!}/rest/v1/items?id=eq.${itemA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgB.access_token}`,
          accept: 'application/json',
        },
      });
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A items').toHaveLength(0);

      const ownRes = await request.get(`${SUPABASE_URL!}/rest/v1/items?id=eq.${itemA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgA.access_token}`,
          accept: 'application/json',
        },
      });
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own item').toBe(1);
      expect(ownBody[0]!.id).toBe(itemA);
    } finally {
      await adminClient().from('items').delete().eq('id', itemA);
    }
  });

  test('user B cannot read user A tax via PostgREST', async ({ request }) => {
    const taxA = await seedTax(orgA);
    try {
      const res = await request.get(`${SUPABASE_URL!}/rest/v1/taxes?id=eq.${taxA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgB.access_token}`,
          accept: 'application/json',
        },
      });
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A taxes').toHaveLength(0);

      const ownRes = await request.get(`${SUPABASE_URL!}/rest/v1/taxes?id=eq.${taxA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgA.access_token}`,
          accept: 'application/json',
        },
      });
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own tax').toBe(1);
      expect(ownBody[0]!.id).toBe(taxA);
    } finally {
      await adminClient().from('taxes').delete().eq('id', taxA);
    }
  });

  test('user B cannot read user A payment_method via PostgREST', async ({ request }) => {
    const pmA = await seedPaymentMethod(orgA);
    try {
      const res = await request.get(
        `${SUPABASE_URL!}/rest/v1/payment_methods?id=eq.${pmA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgB.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A payment_methods').toHaveLength(0);

      const ownRes = await request.get(
        `${SUPABASE_URL!}/rest/v1/payment_methods?id=eq.${pmA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgA.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own payment_method').toBe(1);
      expect(ownBody[0]!.id).toBe(pmA);
    } finally {
      await adminClient().from('payment_methods').delete().eq('id', pmA);
    }
  });

  test('user B cannot read user A item_category via PostgREST', async ({ request }) => {
    const catA = await seedItemCategory(orgA);
    try {
      const res = await request.get(
        `${SUPABASE_URL!}/rest/v1/item_categories?id=eq.${catA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgB.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A item_categories').toHaveLength(0);

      const ownRes = await request.get(
        `${SUPABASE_URL!}/rest/v1/item_categories?id=eq.${catA}`,
        {
          headers: {
            apikey: ANON_KEY!,
            authorization: `Bearer ${orgA.access_token}`,
            accept: 'application/json',
          },
        },
      );
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own item_category').toBe(1);
      expect(ownBody[0]!.id).toBe(catA);
    } finally {
      await adminClient().from('item_categories').delete().eq('id', catA);
    }
  });

  test('user B cannot read user A unit via PostgREST', async ({ request }) => {
    const unitA = await seedUnit(orgA);
    try {
      const res = await request.get(`${SUPABASE_URL!}/rest/v1/units?id=eq.${unitA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgB.access_token}`,
          accept: 'application/json',
        },
      });
      expect(res.status(), 'RLS must filter, not throw').toBe(200);
      const body = (await res.json()) as unknown[];
      expect(body, 'org B must see zero org A units').toHaveLength(0);

      const ownRes = await request.get(`${SUPABASE_URL!}/rest/v1/units?id=eq.${unitA}`, {
        headers: {
          apikey: ANON_KEY!,
          authorization: `Bearer ${orgA.access_token}`,
          accept: 'application/json',
        },
      });
      expect(ownRes.status()).toBe(200);
      const ownBody = (await ownRes.json()) as Array<{ id: string }>;
      expect(ownBody.length, 'org A must see its own unit').toBe(1);
      expect(ownBody[0]!.id).toBe(unitA);
    } finally {
      await adminClient().from('units').delete().eq('id', unitA);
    }
  });

  /**
   * `public.exchange_rates` has NO `org_id`; it is GLOBAL reference data
   * with an unconditional SELECT policy (qual: true; see migration 0033).
   * A cross-tenant probe is not meaningful here — by design, any signed-in
   * caller from any org sees the same rows. Assert that property positively:
   * orgA seeds a unique-tuple row, then both orgA and orgB read it.
   */
  test('exchange_rates: both orgs see the same global row (no org_id filter)', async ({
    request,
  }) => {
    const rateId = await seedExchangeRate();
    try {
      const headers = (token: string) => ({
        apikey: ANON_KEY!,
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      });
      const resA = await request.get(
        `${SUPABASE_URL!}/rest/v1/exchange_rates?id=eq.${rateId}`,
        { headers: headers(orgA.access_token) },
      );
      const resB = await request.get(
        `${SUPABASE_URL!}/rest/v1/exchange_rates?id=eq.${rateId}`,
        { headers: headers(orgB.access_token) },
      );
      expect(resA.status()).toBe(200);
      expect(resB.status()).toBe(200);
      const bodyA = (await resA.json()) as Array<{ id: string }>;
      const bodyB = (await resB.json()) as Array<{ id: string }>;
      expect(bodyA.length, 'org A must see the global rate').toBe(1);
      expect(bodyB.length, 'org B must see the same global rate').toBe(1);
      expect(bodyA[0]!.id).toBe(rateId);
      expect(bodyB[0]!.id).toBe(rateId);
    } finally {
      await adminClient().from('exchange_rates').delete().eq('id', rateId);
    }
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

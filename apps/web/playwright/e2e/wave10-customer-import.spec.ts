import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 20 — end-to-end customer import (Wave 10).
 *
 * Tags: @wave10 @smoke
 *
 * Validates the customer-import happy path:
 *   1. Spin up an ephemeral org + org_owner.
 *   2. POST /imports-api/imports/customers (dry_run) → 200 + preview envelope
 *      with stats.valid_rows === 2 (fixture has 2 valid rows).
 *   3. POST /imports-api/imports/customers/commit → 200 + inserted_count === 2.
 *   4. Service-role query confirms 2 customers exist with the expected names.
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
  const email = `wave10-imp-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave10-imp-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Wave10 Import Smoke', default_currency_code: 'USD' })
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
  await admin.from('profiles').insert({ user_id, email, display_name: 'Wave10 Import Smoke' });

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
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.user_id).catch(() => undefined);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_branding').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

function csvFixture(): string {
  return [
    'display_name,kind,email',
    'Wave10 Acme Co,company,acme@wave10.test',
    'Wave10 Beta LLC,company,beta@wave10.test',
  ].join('\n');
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64');
}

test.describe('@wave10 @smoke Phase 20 customer import end-to-end', () => {
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

  test('preview → commit inserts 2 customers', async ({ request }) => {
    test.setTimeout(60_000);
    const baseHeaders = {
      authorization: `Bearer ${fx.access_token}`,
      apikey: ANON_KEY!,
      'content-type': 'application/json',
    };
    const csv_b64 = b64(csvFixture());

    // Step 1: preview
    const preview = await request.post(`${functionsBase()}/imports-api/imports/customers`, {
      headers: { ...baseHeaders, 'idempotency-key': crypto.randomUUID() },
      data: { csv_b64, dry_run: true },
    });
    if (preview.status() === 404) {
      test.skip(true, 'imports-api not yet deployed against this Supabase project');
    }
    expect(preview.status(), `preview body: ${await preview.text()}`).toBe(200);
    const previewBody = (await preview.json()) as {
      data: {
        errors: unknown[];
        stats: { total_rows: number; valid_rows: number; error_rows: number };
      };
    };
    expect(previewBody.data.errors).toHaveLength(0);
    expect(previewBody.data.stats.valid_rows).toBe(2);
    expect(previewBody.data.stats.error_rows).toBe(0);

    // Step 2: commit
    const commit = await request.post(
      `${functionsBase()}/imports-api/imports/customers/commit`,
      {
        headers: { ...baseHeaders, 'idempotency-key': crypto.randomUUID() },
        data: { csv_b64 },
      },
    );
    expect(commit.status(), `commit body: ${await commit.text()}`).toBe(200);
    const commitBody = (await commit.json()) as {
      data: { inserted_count: number };
    };
    expect(commitBody.data.inserted_count).toBe(2);

    // Step 3: verify via service role
    const admin = adminClient();
    const { data: rows, error } = await admin
      .from('customers')
      .select('display_name')
      .eq('org_id', fx.org_id)
      .order('display_name');
    expect(error).toBeFalsy();
    const names = (rows ?? []).map((r) => r.display_name).sort();
    expect(names).toContain('Wave10 Acme Co');
    expect(names).toContain('Wave10 Beta LLC');
  });
});

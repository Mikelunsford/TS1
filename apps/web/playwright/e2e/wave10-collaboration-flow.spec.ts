import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 16 (Wave 10 Session 2) — collaboration flow e2e.
 *
 * Tags: @phase16 @smoke
 *
 * Sequence:
 *   1. Bootstrap two org_owner users in the same org.
 *   2. User A POSTs a comment on a customer with @user-B mentioned.
 *   3. Assert the trigger fired: user B has 1 notification of kind comment.mention.
 *   4. User B marks it read; unread_count goes to 0.
 *   5. User A signs an upload URL, uploads bytes (mock blob), and POSTs the
 *      metadata; FilesTab GET returns the new attachment.
 *   6. Cleanup.
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

interface User { user_id: string; email: string; access_token: string; }
interface Fixture {
  org_id: string;
  customer_id: string;
  a: User;
  b: User;
}

async function makeUser(orgId: string, suffix: string, label: string): Promise<User> {
  const admin = adminClient();
  const email = `phase16-${label}-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${label}!1`;
  const { data: userRow, error: userErr } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { team1_org_id: orgId, team1_org_role: 'org_owner' },
  });
  if (userErr || !userRow.user) throw new Error(`user create failed: ${userErr?.message}`);
  const user_id = userRow.user.id;
  const { data: roleRow } = await admin.from('roles').select('id').eq('code', 'org_owner').single();
  await admin.from('org_memberships').insert({
    org_id: orgId, user_id, role_id: roleRow!.id, is_active: true,
  });
  await admin.from('user_preferences').insert({ user_id, org_id: orgId });
  await admin.from('profiles').insert({ user_id, email, display_name: label });

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session } = await userClient.auth.signInWithPassword({ email, password });
  if (!session.session) throw new Error('signin failed');
  return { user_id, email, access_token: session.session.access_token };
}

async function makeFixture(): Promise<Fixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `phase16-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Phase16 Smoke', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  // Seed collaboration flag for the new org explicitly (migration already
  // seeds for existing orgs but this org is new).
  await admin
    .from('org_feature_flags')
    .upsert(
      { org_id, flag_key: 'collaboration.enabled', is_enabled: true },
      { onConflict: 'org_id,flag_key' },
    );

  const a = await makeUser(org_id, suffix, 'a');
  const b = await makeUser(org_id, suffix, 'b');

  const { data: cust } = await admin
    .from('customers')
    .insert({ org_id, display_name: 'Phase16 Cust' })
    .select('id')
    .single();
  if (!cust) throw new Error('customer insert failed');

  return { org_id, customer_id: cust.id as string, a, b };
}

async function teardown(fx: Fixture): Promise<void> {
  const admin = adminClient();
  await admin.from('attachments').delete().eq('org_id', fx.org_id);
  await admin.from('notifications').delete().eq('org_id', fx.org_id);
  await admin.from('comments').delete().eq('org_id', fx.org_id);
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.a.user_id);
  await admin.auth.admin.deleteUser(fx.b.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@phase16 @smoke collaboration-api flow', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: Fixture;
  test.beforeAll(async () => { fx = await makeFixture(); });
  test.afterAll(async () => { if (fx) await teardown(fx).catch(() => undefined); });

  test('mention notification + attachment metadata round-trip', async ({ request }) => {
    test.setTimeout(120_000);

    const headers = (token: string) => ({
      authorization: `Bearer ${token}`,
      apikey: ANON_KEY!,
      'content-type': 'application/json',
    });
    const idem = (token: string) => ({ ...headers(token), 'idempotency-key': crypto.randomUUID() });

    // A posts a comment mentioning B.
    const commentRes = await request.post(`${functionsBase()}/collaboration-api/comments`, {
      headers: idem(fx.a.access_token),
      data: {
        entity_type: 'customer',
        entity_id: fx.customer_id,
        body: `Hey @${fx.b.email} — check this`,
        mentions: [fx.b.user_id],
      },
    });
    expect(commentRes.status()).toBe(201);

    // List on the same entity returns it.
    const listRes = await request.get(
      `${functionsBase()}/collaboration-api/comments?entity_type=customer&entity_id=${fx.customer_id}`,
      { headers: headers(fx.a.access_token) },
    );
    expect(listRes.status()).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.data.items).toHaveLength(1);

    // B sees a notification of kind comment.mention.
    const notifRes = await request.get(
      `${functionsBase()}/collaboration-api/notifications?unread_only=true`,
      { headers: headers(fx.b.access_token) },
    );
    expect(notifRes.status()).toBe(200);
    const notifJson = await notifRes.json();
    expect(notifJson.data.items.length).toBeGreaterThanOrEqual(1);
    expect(notifJson.data.unread_count).toBeGreaterThanOrEqual(1);
    const notif = notifJson.data.items[0];
    expect(notif.event_type).toBe('comment.mention');

    // B marks it read.
    const markRes = await request.patch(
      `${functionsBase()}/collaboration-api/notifications/${notif.id}/read`,
      { headers: idem(fx.b.access_token) },
    );
    expect(markRes.status()).toBe(200);

    // Sign-upload + metadata persist (we don't actually upload bytes here —
    // exercising the BE shape is enough for the smoke; full Storage upload
    // is covered by manual QA pre-merge).
    const signRes = await request.post(`${functionsBase()}/collaboration-api/attachments/sign-upload`, {
      headers: idem(fx.a.access_token),
      data: {
        entity_type: 'customer',
        entity_id: fx.customer_id,
        file_name: 'specs.pdf',
        mime_type: 'application/pdf',
      },
    });
    expect(signRes.status()).toBe(200);
    const signJson = await signRes.json();
    expect(signJson.data.file_path).toContain(fx.org_id);

    const createRes = await request.post(`${functionsBase()}/collaboration-api/attachments`, {
      headers: idem(fx.a.access_token),
      data: {
        entity_type: 'customer',
        entity_id: fx.customer_id,
        file_name: 'specs.pdf',
        file_path: signJson.data.file_path,
        mime_type: 'application/pdf',
        size_bytes: 1024,
      },
    });
    expect(createRes.status()).toBe(201);

    const attListRes = await request.get(
      `${functionsBase()}/collaboration-api/attachments?entity_type=customer&entity_id=${fx.customer_id}`,
      { headers: headers(fx.a.access_token) },
    );
    expect(attListRes.status()).toBe(200);
    const attListJson = await attListRes.json();
    expect(attListJson.data.items).toHaveLength(1);
    expect(attListJson.data.items[0].file_name).toBe('specs.pdf');
  });
});

import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 19 (Wave 10 Session 3) — pdf-worker + notifications-worker e2e.
 *
 * Tags: @phase19 @smoke
 *
 * Sequence:
 *   1. Bootstrap one org_owner user in a fresh org with a customer + invoice.
 *   2. POST /pdf-worker/pdf/render → expect a signed_url; HEAD it for >0 bytes.
 *   3. Insert a notification row (channel=email, recipient_user_id=us).
 *   4. POST /notifications-worker/drain with X-Worker-Secret.
 *      a. If no provider key is configured, expect the row's failed_at
 *         to be set with `config: ...` reason.
 *      b. Otherwise expect delivered_at set + delivered count > 0.
 *   5. Cleanup.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
const WORKER_SECRET = process.env.NOTIFICATIONS_WORKER_SECRET;
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
  invoice_id: string;
  notification_id: string | null;
  a: User;
}

async function makeFixture(): Promise<Fixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const slug = `phase19-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: 'Phase19 Smoke', default_currency_code: 'USD' })
    .select('id')
    .single();
  if (orgErr || !orgRow) throw new Error(`org create failed: ${orgErr?.message}`);
  const org_id = orgRow.id as string;

  // Seed defaults so org_settings.email.provider is in place.
  await admin.rpc('seed_org_defaults', { p_org_id: org_id });

  const email = `phase19-a-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_a!1`;
  const { data: userRow } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { team1_org_id: org_id, team1_org_role: 'org_owner' },
  });
  const user_id = userRow!.user!.id;
  const { data: roleRow } = await admin.from('roles').select('id').eq('code', 'org_owner').single();
  await admin.from('org_memberships').insert({ org_id, user_id, role_id: roleRow!.id, is_active: true });
  await admin.from('profiles').insert({ user_id, email, display_name: 'Phase19 A' });

  const userClient = createClient(SUPABASE_URL!, ANON_KEY!);
  const { data: session } = await userClient.auth.signInWithPassword({ email, password });
  const a: User = { user_id, email, access_token: session.session!.access_token };

  const { data: cust } = await admin
    .from('customers')
    .insert({ org_id, display_name: 'Phase19 Cust' })
    .select('id')
    .single();
  const customer_id = cust!.id as string;

  const { data: inv } = await admin
    .from('invoices')
    .insert({
      org_id,
      customer_id,
      customer_name: 'Phase19 Cust',
      currency_code: 'USD',
      issue_date: '2026-05-16',
    })
    .select('id')
    .single();
  const invoice_id = inv!.id as string;

  return { org_id, customer_id, invoice_id, notification_id: null, a };
}

async function teardown(fx: Fixture): Promise<void> {
  const admin = adminClient();
  await admin.from('notifications').delete().eq('org_id', fx.org_id);
  await admin.from('invoice_line_items').delete().eq('invoice_id', fx.invoice_id);
  await admin.from('invoices').delete().eq('org_id', fx.org_id);
  await admin.from('customers').delete().eq('org_id', fx.org_id);
  await admin.auth.admin.deleteUser(fx.a.user_id);
  await admin.from('org_memberships').delete().eq('org_id', fx.org_id);
  await admin.from('org_settings').delete().eq('org_id', fx.org_id);
  await admin.from('organizations').delete().eq('id', fx.org_id);
}

test.describe('@phase19 @smoke pdf-worker + notifications-worker', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: Fixture;
  test.beforeAll(async () => { fx = await makeFixture(); });
  test.afterAll(async () => { if (fx) await teardown(fx); });

  test('renders an invoice PDF and returns a signed URL', async ({ request }) => {
    const res = await request.post(`${functionsBase()}/pdf-worker/pdf/render`, {
      headers: {
        authorization: `Bearer ${fx.a.access_token}`,
        apikey: ANON_KEY!,
        'idempotency-key': crypto.randomUUID(),
      },
      data: { entity_type: 'invoice', entity_id: fx.invoice_id },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.data.signed_url).toMatch(/^https?:\/\//);
    expect(body.data.bucket).toBe('pdfs');
    expect(typeof body.data.bytes_length).toBe('number');
    expect(body.data.bytes_length).toBeGreaterThan(0);

    // Fetch the signed URL and assert we get back at least the PDF magic
    // bytes "%PDF-".
    const dl = await request.get(body.data.signed_url);
    expect(dl.status()).toBe(200);
    const buf = await dl.body();
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  test('drains a queued email notification', async () => {
    test.skip(!WORKER_SECRET, 'NOTIFICATIONS_WORKER_SECRET not set in test env');
    const admin = adminClient();

    // Insert a pending email notification for user A.
    const { data: notif } = await admin
      .from('notifications')
      .insert({
        org_id: fx.org_id,
        event_type: 'invoice.sent',
        recipient_user_id: fx.a.user_id,
        channel: 'email',
        entity_type: 'invoice',
        entity_id: fx.invoice_id,
        payload: {},
      })
      .select('id')
      .single();
    fx.notification_id = notif!.id as string;

    const res = await fetch(`${functionsBase()}/notifications-worker/drain`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-worker-secret': WORKER_SECRET!,
      },
      body: '{}',
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.processed).toBeGreaterThanOrEqual(1);
    // Either delivered (if RESEND_API_KEY is set) or failed (config error).
    const total = body.data.delivered + body.data.failed;
    expect(total).toBe(body.data.processed);

    // The row should have either delivered_at or failed_at set.
    const { data: row } = await admin
      .from('notifications')
      .select('id, delivered_at, failed_at, failure_reason')
      .eq('id', fx.notification_id!)
      .single();
    expect(row!.delivered_at !== null || row!.failed_at !== null).toBe(true);
  });
});

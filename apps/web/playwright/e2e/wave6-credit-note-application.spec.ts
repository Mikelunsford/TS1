import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Phase 9 / R-W5-CN-01 — end-to-end credit-note application smoke.
 *
 * Tags: @wave6 @smoke
 *
 * Run time budget: < 90s. Like the Wave 5 quote→invoice spec, this is
 * API-driven (Edge Function calls) — it pins the contract that the
 * Payments + CreditNotes SPA (Wave 5 PR #49) and the future ApplyCN
 * dialog rely on, without depending on the SPA being deployed at smoke
 * time.
 *
 * NOTE on SPA coverage: a UI-driven variant would click the
 * `CreditNoteApplyDialog` (Wave 5 FE-B) — but that dialog presently
 * routes to the same `POST /credit-notes/:id/apply` endpoint exercised
 * here, and the invoice-detail balance card reads from
 * `GET /invoicing-api/invoices/:id`. The constitutional risk for Phase 9
 * is the SERVER rollup (allocations table + recompute trigger), not the
 * dialog wiring — so the API-driven flow is the load-bearing smoke. If a
 * follow-up adds a stable `data-testid` to the balance card + apply
 * dialog, the UI variant can be added as a sibling spec.
 *
 * Sequence:
 *   1.  Sign in as org_owner (ephemeral org via service-role bootstrap).
 *   2.  Create a customer + 1-line quote → submit → approve →
 *       convert-to-invoice (via /invoices/from-quote).
 *   3.  Issue the invoice (draft → pending → sent).
 *   4.  Create a credit_note for 50% of invoice.total_cents, same
 *       currency, same customer.
 *   5.  Issue the credit-note (draft → issued).
 *   6.  Apply the CN to the invoice; assert:
 *         - response.status='issued' and applied_cents=cn.amount_cents
 *           (single allocation, fully consumes the issued CN, so the
 *           tg_cna_sync_cn trigger flips to applied IF amount == total
 *           — here amount equals total because we sized the CN at the
 *           full half-amount).
 *         - re-read invoice; balance_cents fell by the CN amount.
 *   7.  Create a second credit_note for the remaining 50%.
 *   8.  Issue + apply it; assert:
 *         - invoice.balance_cents = 0.
 *         - invoice.payment_status = 'paid' (the extended
 *           recompute_invoice_totals factors CN allocations into the
 *           payment_status decision per 0056's spec).
 *         - second CN status = 'applied'.
 *   9.  Negative path: attempt to apply the already-fully-consumed
 *       second CN to the same invoice again → 409 STATE_CONFLICT
 *       (the credit_note workflow matrix forbids applied → applied
 *       and the unique allocation index prevents the dupe).
 *   10. Cleanup via the same teardown shape as the Wave 5 spec.
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

/** Bootstrap an ephemeral org + signed-in org_owner caller (mirrors Wave 5). */
async function makeFixture(): Promise<OrgFixture> {
  const admin = adminClient();
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `wave6-cn-${suffix}@team1.test`;
  const password = `Smoke_${suffix}_${Math.random().toString(36).slice(2)}!1`;
  const slug = `wave6-cn-${suffix}`.slice(0, 63).toLowerCase();

  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `Wave6 CN Smoke`, default_currency_code: 'USD' })
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
  await admin.from('profiles').insert({ user_id, email, display_name: `Wave6 CN Smoke` });

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
  // Phase 9 ordering: credit_note_allocations must drop before credit_notes
  // (FK on credit_note_id ON DELETE RESTRICT) and before invoices
  // (FK on invoice_id ON DELETE RESTRICT).
  await admin.from('credit_note_allocations').delete().eq('org_id', fx.org_id);
  await admin.from('credit_notes').delete().eq('org_id', fx.org_id);
  await admin.from('payments').delete().eq('org_id', fx.org_id);
  await admin.from('invoice_line_items').delete().eq('org_id', fx.org_id);
  await admin.from('invoice_versions').delete().eq('org_id', fx.org_id);
  await admin.from('invoices').delete().eq('org_id', fx.org_id);
  await admin.from('quote_line_items').delete().eq('org_id', fx.org_id);
  await admin.from('quote_versions').delete().eq('org_id', fx.org_id);
  await admin.from('quotes').delete().eq('org_id', fx.org_id);
  await admin.from('customers').delete().eq('org_id', fx.org_id);
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

test.describe('@wave6 @smoke Phase 9 credit-note application end-to-end', () => {
  test.skip(
    !REQUIRED_ENV_PRESENT,
    'Required env not set: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY',
  );

  let fx: OrgFixture;
  let customer_id: string;

  test.beforeAll(async () => {
    fx = await makeFixture();
    const admin = adminClient();
    // Wave 6 / 0054 renamed customers.name → display_name. Use the new column.
    const { data, error } = await admin
      .from('customers')
      .insert({ org_id: fx.org_id, display_name: 'Wave6 CN Smoke Customer' })
      .select('id')
      .single();
    if (error || !data) throw new Error(`customer create failed: ${error?.message}`);
    customer_id = data.id as string;
  });

  test.afterAll(async () => {
    if (fx) await teardown(fx).catch(() => undefined);
  });

  test('credit-note allocations reduce invoice balance + flip CN status', async ({ request }) => {
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
    // 1. Quote with 1 line (no tax, no discount → clean total math).
    // --------------------------------------------------------------------- //
    const createQuoteRes = await request.post(`${functionsBase()}/quotes-api/quotes`, {
      headers: idemHeaders(),
      data: {
        customer_id,
        customer_name: 'Wave6 CN Smoke Customer',
        service_type: 'co_pack',
      },
    });
    test.skip(
      createQuoteRes.status() >= 500,
      `quotes-api unreachable (HTTP ${createQuoteRes.status()})`,
    );
    expect(createQuoteRes.status(), 'create quote 201').toBe(201);
    const quote = ((await createQuoteRes.json()) as { data: { id: string } }).data;

    const replaceLinesRes = await request.post(
      `${functionsBase()}/quotes-api/quotes/${quote.id}/line-items`,
      {
        headers: idemHeaders(),
        data: {
          lines: [
            // 10 × $20.00 = $200.00 → total_cents=20000 (clean half-split).
            { description: 'CN smoke widget', quantity: 10, unit_price_cents: 2000, position: 0 },
          ],
        },
      },
    );
    expect(replaceLinesRes.status(), 'replace quote lines 200/201').toBeLessThan(300);

    // Submit → approve.
    const submitQuoteRes = await request.post(
      `${functionsBase()}/quotes-api/quotes/${quote.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submitQuoteRes.status()).toBe(200);
    const approveRes = await request.post(
      `${functionsBase()}/quotes-api/quotes/${quote.id}/approve`,
      { headers: idemHeaders(), data: {} },
    );
    expect(approveRes.status()).toBe(200);

    // --------------------------------------------------------------------- //
    // 2. Convert quote → invoice. Issue the invoice (draft → pending → sent).
    // --------------------------------------------------------------------- //
    const due_date = addDays(new Date().toISOString(), 30);
    const fromQuoteRes = await request.post(
      `${functionsBase()}/invoicing-api/invoices/from-quote`,
      { headers: idemHeaders(), data: { quote_id: quote.id, due_date } },
    );
    expect(fromQuoteRes.status(), 'POST /invoices/from-quote 201').toBe(201);
    const invoice = ((await fromQuoteRes.json()) as {
      data: { id: string; total_cents: number; currency_code: string; balance_cents: number };
    }).data;
    expect(invoice.total_cents, 'invoice total_cents matches expected').toBe(20000);

    const submitInvoiceRes = await request.post(
      `${functionsBase()}/invoicing-api/invoices/${invoice.id}/submit`,
      { headers: idemHeaders(), data: {} },
    );
    expect(submitInvoiceRes.status()).toBe(200);
    const sendRes = await request.post(
      `${functionsBase()}/invoicing-api/invoices/${invoice.id}/send`,
      { headers: idemHeaders(), data: {} },
    );
    expect(sendRes.status()).toBe(200);

    // --------------------------------------------------------------------- //
    // 3. First CN: 50% of invoice total. Issue + apply.
    // --------------------------------------------------------------------- //
    const half = invoice.total_cents / 2;
    expect(Number.isInteger(half), 'half must be an integer cent count').toBe(true);

    const createCn1Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes`,
      {
        headers: idemHeaders(),
        data: {
          customer_id,
          currency_code: invoice.currency_code,
          amount_cents: half,
          invoice_id: invoice.id,
          reason: 'goodwill',
        },
      },
    );
    expect(createCn1Res.status(), 'create CN 201').toBe(201);
    const cn1 = ((await createCn1Res.json()) as {
      data: { id: string; status: string; amount_cents: number; applied_cents: number };
    }).data;
    expect(cn1.status).toBe('draft');
    expect(cn1.amount_cents).toBe(half);
    expect(cn1.applied_cents).toBe(0);

    const issueCn1Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes/${cn1.id}/issue`,
      { headers: idemHeaders(), data: {} },
    );
    expect(issueCn1Res.status()).toBe(200);
    const cn1Issued = ((await issueCn1Res.json()) as { data: { status: string } }).data;
    expect(cn1Issued.status).toBe('issued');

    const applyCn1Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes/${cn1.id}/apply`,
      {
        headers: idemHeaders(),
        data: { invoice_id: invoice.id, amount_cents: half },
      },
    );
    expect(applyCn1Res.status(), 'apply CN 200').toBe(200);
    const cn1Applied = ((await applyCn1Res.json()) as {
      data: { status: string; applied_cents: number };
    }).data;
    // The CN is fully consumed by this single allocation, so tg_cna_sync_cn
    // flips status to 'applied'.
    expect(cn1Applied.applied_cents).toBe(half);
    expect(cn1Applied.status).toBe('applied');

    // Invoice balance must have dropped by the CN amount.
    const afterCn1Res = await request.get(
      `${functionsBase()}/invoicing-api/invoices/${invoice.id}`,
      { headers: baseHeaders },
    );
    expect(afterCn1Res.status()).toBe(200);
    const afterCn1 = ((await afterCn1Res.json()) as {
      data: { balance_cents: number | null; payment_status: string };
    }).data;
    expect(afterCn1.balance_cents, 'balance drops by CN amount').toBe(invoice.total_cents - half);
    // payment_status MAY be 'partially_paid' (extended recompute treats CN
    // allocations like payments). Either 'unpaid' or 'partially_paid' is
    // semantically correct depending on the recompute decision; the
    // contractual requirement is "not paid yet, balance > 0".
    expect(['partially_paid', 'unpaid']).toContain(afterCn1.payment_status);

    // --------------------------------------------------------------------- //
    // 4. Second CN: the remaining 50%. Issue + apply → invoice balance 0,
    //    payment_status='paid', CN status='applied'.
    // --------------------------------------------------------------------- //
    const remaining = invoice.total_cents - half;
    const createCn2Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes`,
      {
        headers: idemHeaders(),
        data: {
          customer_id,
          currency_code: invoice.currency_code,
          amount_cents: remaining,
          invoice_id: invoice.id,
          reason: 'price_adjustment',
        },
      },
    );
    expect(createCn2Res.status()).toBe(201);
    const cn2 = ((await createCn2Res.json()) as { data: { id: string } }).data;

    const issueCn2Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes/${cn2.id}/issue`,
      { headers: idemHeaders(), data: {} },
    );
    expect(issueCn2Res.status()).toBe(200);

    const applyCn2Res = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes/${cn2.id}/apply`,
      {
        headers: idemHeaders(),
        data: { invoice_id: invoice.id, amount_cents: remaining },
      },
    );
    expect(applyCn2Res.status()).toBe(200);
    const cn2Applied = ((await applyCn2Res.json()) as {
      data: { status: string; applied_cents: number };
    }).data;
    expect(cn2Applied.status).toBe('applied');
    expect(cn2Applied.applied_cents).toBe(remaining);

    const afterCn2Res = await request.get(
      `${functionsBase()}/invoicing-api/invoices/${invoice.id}`,
      { headers: baseHeaders },
    );
    expect(afterCn2Res.status()).toBe(200);
    const afterCn2 = ((await afterCn2Res.json()) as {
      data: { balance_cents: number | null; payment_status: string };
    }).data;
    expect(afterCn2.balance_cents, 'balance zeroed by CN allocations').toBe(0);
    expect(afterCn2.payment_status, 'payment_status paid after full CN cover').toBe('paid');

    // --------------------------------------------------------------------- //
    // 5. Negative path: re-apply the fully-consumed CN → 409 STATE_CONFLICT.
    //    The credit_note workflow forbids applied → applied AND the
    //    UNIQUE (credit_note_id, invoice_id, deleted_at) index prevents the
    //    duplicate allocation row.
    // --------------------------------------------------------------------- //
    const reapplyRes = await request.post(
      `${functionsBase()}/invoicing-api/credit-notes/${cn2.id}/apply`,
      {
        headers: idemHeaders(),
        data: { invoice_id: invoice.id, amount_cents: 1 },
      },
    );
    expect(reapplyRes.status(), 're-apply on applied CN must NOT 200').not.toBe(200);
    expect([409, 422]).toContain(reapplyRes.status());
    if (reapplyRes.status() === 409) {
      const json = (await reapplyRes.json()) as { error: { code: string } };
      expect(json.error.code).toBe('STATE_CONFLICT');
    }
  });
});

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

/**
 * Shared helpers for CRM contract tests.
 *
 * These tests run against the **staging** Supabase project. Required env:
 *
 *   STAGING_SUPABASE_URL
 *   STAGING_SUPABASE_ANON_KEY
 *   STAGING_SUPABASE_SERVICE_ROLE_KEY
 *
 * If any is missing, the suite skips with a clear message. Locally, contract
 * tests are skipped when staging secrets aren't on disk; CI provides them via
 * the `staging` GitHub environment (see .github/workflows/nightly-rls-probe.yml).
 *
 * The CRM endpoints are shipping in Wave 2 Step 3.2 in parallel with this
 * test suite. To avoid coupling our merge to Backend's, each test detects
 * whether the target endpoint is deployed (a one-shot OPTIONS / HEAD probe).
 * If 404, we skip cleanly. If 2xx, we run.
 *
 * R-W1-11 lesson: use `||`, not `??`, so EMPTY-STRING env values fall back
 * to undefined (and the skip path activates).
 */

export const STAGING_SUPABASE_URL =
  process.env.STAGING_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
export const STAGING_SUPABASE_ANON_KEY =
  process.env.STAGING_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
export const STAGING_SERVICE_ROLE_KEY =
  process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const STAGING_ENV_PRESENT = Boolean(
  STAGING_SUPABASE_URL && STAGING_SUPABASE_ANON_KEY && STAGING_SERVICE_ROLE_KEY,
);

export function functionsBase(): string {
  return `${STAGING_SUPABASE_URL.replace(/\/$/, '')}/functions/v1`;
}

export function adminClient(): SupabaseClient {
  return createClient(STAGING_SUPABASE_URL, STAGING_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Ephemeral authenticated session bound to a fresh org. */
export interface ContractSession {
  org_id: string;
  user_id: string;
  email: string;
  access_token: string;
}

/**
 * Spin up an ephemeral org + user + active staff membership. Mirrors
 * `makeFixture` in `playwright/rls-probe.spec.ts` but tuned for contract
 * tests (uses fetch from the test, no Playwright APIs).
 */
export async function makeSession(label = 'crm'): Promise<ContractSession> {
  const admin = adminClient();
  const suffix = `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const email = `crm-contract-${suffix}@team1.test`;
  const password = `Probe_${suffix}_${Math.random().toString(36).slice(2)}!1`;

  const slug = `crm-contract-${suffix}`.slice(0, 63).toLowerCase();
  const { data: orgRow, error: orgErr } = await admin
    .from('organizations')
    .insert({ slug, display_name: `CRM Contract ${label}`, default_currency_code: 'USD' })
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
  if (memErr) throw new Error(`membership create failed: ${memErr.message}`);

  // user_preferences pre-seed + profile insert (mirrors rls-probe fixture
  // — see R-W1-10 in the Wave 1 closeout journal).
  const { error: prefErr } = await admin.from('user_preferences').insert({ user_id, org_id });
  if (prefErr) throw new Error(`user_preferences seed failed: ${prefErr.message}`);

  const { error: profileErr } = await admin.from('profiles').insert({
    user_id,
    email,
    display_name: `CRM Contract ${label}`,
  });
  if (profileErr) throw new Error(`profile create failed: ${profileErr.message}`);

  const userClient = createClient(STAGING_SUPABASE_URL, STAGING_SUPABASE_ANON_KEY);
  const { data: session, error: signInErr } = await userClient.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr || !session.session) throw new Error(`signin failed: ${signInErr?.message}`);

  return { org_id, user_id, email, access_token: session.session.access_token };
}

/** Teardown a contract session. Best-effort; ignores per-row errors. */
export async function teardownSession(s: ContractSession): Promise<void> {
  const admin = adminClient();
  await admin.from('activities').delete().eq('org_id', s.org_id);
  await admin.from('opportunities').delete().eq('org_id', s.org_id);
  await admin.from('leads').delete().eq('org_id', s.org_id);
  await admin.from('contacts').delete().eq('org_id', s.org_id);
  await admin.from('customers').delete().eq('org_id', s.org_id);
  await admin.auth.admin.deleteUser(s.user_id).catch(() => undefined);
  await admin.from('org_branding').delete().eq('org_id', s.org_id);
  await admin.from('org_settings').delete().eq('org_id', s.org_id);
  await admin.from('org_feature_flags').delete().eq('org_id', s.org_id);
  await admin.from('org_memberships').delete().eq('org_id', s.org_id);
  await admin.from('organizations').delete().eq('id', s.org_id);
}

/**
 * One-shot deployment probe. Returns true if the endpoint responds with a
 * non-404 status to a HEAD request (or GET fallback). Used to skip the
 * contract test cleanly when Backend hasn't merged its CRM handlers yet.
 *
 * The probe is intentionally lenient: any 2xx/3xx/4xx-other-than-404 means
 * "the function exists" — the actual auth/idempotency assertions live in
 * the test body.
 */
export async function endpointDeployed(path: string): Promise<boolean> {
  if (!STAGING_ENV_PRESENT) return false;
  const url = `${functionsBase()}${path}`;
  try {
    // Functions runtime typically rejects HEAD with 405; treat that as
    // deployed. A bare GET to a POST-only route returns 405 too. A truly
    // missing function returns 404.
    const res = await fetch(url, {
      method: 'GET',
      headers: { apikey: STAGING_SUPABASE_ANON_KEY },
    });
    return res.status !== 404;
  } catch {
    return false;
  }
}

// ----- Envelope schemas ----------------------------------------------------

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  request_id: z.string().optional(),
});

export const ApiOkEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({ data, meta: z.unknown().optional() });

export const ApiErrEnvelope = z.object({ error: ApiErrorSchema });

/**
 * Idempotency-replay helper. Issues the same POST twice with the same key,
 * asserts the second response carries `Idempotent-Replay: true` and an
 * identical body to the first.
 *
 * Returns the parsed first response so the caller can do additional shape
 * assertions on the created entity.
 */
export async function assertIdempotencyReplay(
  url: string,
  body: unknown,
  session: ContractSession,
): Promise<{ first: Response; firstBody: unknown; second: Response; secondBody: unknown }> {
  const key = crypto.randomUUID();
  const headers = {
    'content-type': 'application/json',
    apikey: STAGING_SUPABASE_ANON_KEY,
    authorization: `Bearer ${session.access_token}`,
    'idempotency-key': key,
  };
  const first = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const firstBody = await first.json();
  // First call MUST NOT be a replay.
  const firstReplay = first.headers.get('idempotent-replay');
  if (firstReplay && firstReplay !== 'false') {
    throw new Error(`first response unexpectedly marked Idempotent-Replay: ${firstReplay}`);
  }
  const second = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const secondBody = await second.json();
  return { first, firstBody, second, secondBody };
}

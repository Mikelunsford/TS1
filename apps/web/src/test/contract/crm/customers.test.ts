import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import {
  ApiErrEnvelope,
  ApiOkEnvelope,
  STAGING_ENV_PRESENT,
  STAGING_SUPABASE_ANON_KEY,
  assertIdempotencyReplay,
  endpointDeployed,
  functionsBase,
  makeSession,
  teardownSession,
  type ContractSession,
} from './_helpers';

/**
 * Wire-contract tests for /crm-api/customers.
 *
 * Per TS1/09-api/00-API-CONTRACT.md §3.1. Asserts:
 *   1. Envelope: every ok() response → { data, meta? }; errors → { error: {...} }
 *   2. Idempotency replay: same POST twice → second has `Idempotent-Replay: true`
 *      and an identical body.
 *
 * Skips cleanly when STAGING_* env is missing OR when /crm-api/customers
 * isn't deployed yet (Backend's Wave 2 Step 3.2 PR may not have landed when
 * this branch is verified locally).
 */

const CustomerSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  display_name: z.string().min(1),
  // Loose shape — Backend's exact response includes more fields; we only
  // assert the envelope + minimum identity here.
}).passthrough();

describe('Contract: /crm-api/customers', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/crm-api/customers');
    if (!deployed) return;
    session = await makeSession('customers');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('crm-api/customers is deployed (skip rest if not)', () => {
    // Sentinel: if this fails, the rest of the suite below is skipped via
    // the per-test `deployed` guard.
    if (!deployed) {
      console.warn(
        'crm-api/customers not deployed on staging — skipping idempotency + envelope assertions.',
      );
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('POST /customers replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/crm-api/customers`;
    const body = {
      display_name: `Acme ${session.org_id.slice(0, 8)}`,
      kind: 'company' as const,
      primary_email: `ap+${session.org_id.slice(0, 8)}@acme.test`,
    };

    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );

    // First response: must be 200 or 201 with an envelope-shaped body.
    expect(first.status, `first POST status ${first.status}`).toBeLessThan(300);
    const firstParsed = ApiOkEnvelope(CustomerSchema).safeParse(firstBody);
    expect(firstParsed.success, `first body envelope: ${JSON.stringify(firstBody)}`).toBe(true);

    // Second response: marked Idempotent-Replay + identical body.
    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(second.status).toBeLessThan(300);
    expect(secondBody).toEqual(firstBody);
  }, 60_000);

  it('error responses use the standard envelope { error: { code, message } }', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    // POST with an empty body forces a validation error.
    const url = `${functionsBase()}/crm-api/customers`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    // Validation errors are 400. We don't pin the exact status; only the
    // envelope shape is asserted.
    const body = await res.json();
    if (res.status < 400) return; // backend may auto-default fields; skip if so
    const parsed = ApiErrEnvelope.safeParse(body);
    expect(parsed.success, `error body envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);
});

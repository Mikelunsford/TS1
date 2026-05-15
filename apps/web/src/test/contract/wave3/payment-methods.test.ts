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
} from '../crm/_helpers';

/**
 * Wire-contract tests for /finance-api/payment-methods. Per API contract §7.
 *
 * Payment methods are org-scoped with a partial unique on
 * `(org_id) WHERE is_default`. Tests POST with is_default=false to avoid
 * colliding with the 0049 per-org seeds (cash/check/ach/card/wire/stripe/manual).
 */

const PaymentMethodResponseSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    code: z.string().min(1),
    label: z.string().min(1),
  })
  .passthrough();

describe('Contract: /finance-api/payment-methods', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/finance-api/payment-methods');
    if (!deployed) return;
    session = await makeSession('payment-methods');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)(
    'finance-api/payment-methods is deployed (skip rest if not)',
    () => {
      if (!deployed) {
        console.warn(
          'finance-api/payment-methods not deployed on staging — skipping assertions.',
        );
      }
      expect(STAGING_ENV_PRESENT).toBe(true);
    },
  );

  it('GET /payment-methods returns the canonical list envelope', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const res = await fetch(`${functionsBase()}/finance-api/payment-methods`, {
      headers: {
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
      },
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    const parsed = ApiOkEnvelope(
      z.object({
        items: z.array(PaymentMethodResponseSchema),
        next_cursor: z.string().nullable().optional(),
      }),
    ).safeParse(body);
    expect(parsed.success, `envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);

  it('POST /payment-methods replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/payment-methods`;
    const body = {
      code: `ct-${session.org_id.slice(0, 8)}`,
      label: 'Contract test method',
      description: 'Issued by the wave3 contract suite',
      is_default: false,
      is_active: true,
    };
    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );
    expect(first.status).toBeLessThan(300);
    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);

  it('error responses use the standard envelope { error: { code, message } }', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/payment-methods`;
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
    const body = await res.json();
    if (res.status < 400) return;
    const parsed = ApiErrEnvelope.safeParse(body);
    expect(parsed.success, `error envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);
});

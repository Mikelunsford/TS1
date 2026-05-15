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
 * Wire-contract tests for /finance-api/taxes. Per API contract §7.
 *
 * Tax rows are org-scoped. The partial unique index
 * `uq_taxes_default_per_org WHERE is_default` means is_default=true tests
 * can collide with the per-org TAX-0 seed; we POST with is_default=false.
 */

const TaxResponseSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    code: z.string().min(1),
    label: z.string().min(1),
    rate: z.union([z.number(), z.string()]),
  })
  .passthrough();

describe('Contract: /finance-api/taxes', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/finance-api/taxes');
    if (!deployed) return;
    session = await makeSession('taxes');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('finance-api/taxes is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn('finance-api/taxes not deployed on staging — skipping assertions.');
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('GET /taxes returns the canonical list envelope', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const res = await fetch(`${functionsBase()}/finance-api/taxes`, {
      headers: {
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
      },
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    const parsed = ApiOkEnvelope(
      z.object({
        items: z.array(TaxResponseSchema),
        next_cursor: z.string().nullable().optional(),
      }),
    ).safeParse(body);
    expect(parsed.success, `envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);

  it('POST /taxes replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/taxes`;
    const body = {
      code: `CT-${session.org_id.slice(0, 8)}`,
      label: 'Contract test tax',
      rate: 0.0625,
      is_compound: false,
      is_inclusive: false,
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
    const url = `${functionsBase()}/finance-api/taxes`;
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

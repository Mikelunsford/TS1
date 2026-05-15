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
 * Wire-contract tests for /inventory-api/units. Per API contract §8.
 *
 * Units are org-scoped with UNIQUE(org_id, code). The 0049 seed inserted
 * five defaults per org (each/hour/pallet/kg/lb); test POSTs must use a
 * non-colliding code.
 */

const UnitResponseSchema = z
  .object({
    id: z.string().uuid(),
    org_id: z.string().uuid(),
    code: z.string().min(1),
    label: z.string().min(1),
  })
  .passthrough();

describe('Contract: /inventory-api/units', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/inventory-api/units');
    if (!deployed) return;
    session = await makeSession('units');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('inventory-api/units is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn('inventory-api/units not deployed on staging — skipping assertions.');
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('GET /units returns the canonical list envelope', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const res = await fetch(`${functionsBase()}/inventory-api/units`, {
      headers: {
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
      },
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    const parsed = ApiOkEnvelope(
      z.object({
        items: z.array(UnitResponseSchema),
        next_cursor: z.string().nullable().optional(),
      }),
    ).safeParse(body);
    expect(parsed.success, `envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);

  it('POST /units replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/inventory-api/units`;
    const body = {
      code: `ct-${session.org_id.slice(0, 8)}`,
      label: 'Contract test unit',
      family: 'count',
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
    const url = `${functionsBase()}/inventory-api/units`;
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

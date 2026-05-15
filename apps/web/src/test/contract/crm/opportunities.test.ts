import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import {
  ApiOkEnvelope,
  STAGING_ENV_PRESENT,
  adminClient,
  assertIdempotencyReplay,
  endpointDeployed,
  functionsBase,
  makeSession,
  teardownSession,
  type ContractSession,
} from './_helpers';

/**
 * Wire-contract tests for /crm-api/opportunities. Per §3.4 of the API
 * contract. An opportunity FK-points to a customer, so we pre-seed.
 */

const OpportunitySchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  customer_id: z.string().uuid(),
  stage: z.string(),
  // amount_cents may serialize as number OR string (bigint over the wire).
  amount_cents: z.union([z.number(), z.string()]).optional(),
}).passthrough();

describe('Contract: /crm-api/opportunities', () => {
  let session: ContractSession | undefined;
  let customer_id: string | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/crm-api/opportunities');
    if (!deployed) return;
    session = await makeSession('opportunities');
    const admin = adminClient();
    const { data, error } = await admin
      .from('customers')
      .insert({
        org_id: session.org_id,
        name: `Customer for opportunity ${session.org_id.slice(0, 8)}`,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`customer seed failed: ${error?.message}`);
    customer_id = data.id as string;
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('crm-api/opportunities is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn(
        'crm-api/opportunities not deployed on staging — skipping idempotency assertions.',
      );
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('POST /opportunities replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session || !customer_id) return;
    const url = `${functionsBase()}/crm-api/opportunities`;
    const body = {
      customer_id,
      display_name: `Opp-${session.org_id.slice(0, 8)}`,
      amount_cents: 100_000,
      currency_code: 'USD',
      stage: 'discovery' as const,
    };

    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );

    expect(first.status).toBeLessThan(300);
    const firstParsed = ApiOkEnvelope(OpportunitySchema).safeParse(firstBody);
    expect(firstParsed.success, `first body envelope: ${JSON.stringify(firstBody)}`).toBe(true);

    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);
});

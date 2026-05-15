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
 * Wire-contract tests for /crm-api/activities. Per §3.5 of the API contract.
 * Activities are polymorphic: each row references an `entity_type` +
 * `entity_id`. We use a customer entity as the target since the customer
 * fixture is the simplest to seed.
 */

const ActivitySchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  subject: z.string().min(1),
}).passthrough();

describe('Contract: /crm-api/activities', () => {
  let session: ContractSession | undefined;
  let customer_id: string | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/crm-api/activities');
    if (!deployed) return;
    session = await makeSession('activities');
    const admin = adminClient();
    const { data, error } = await admin
      .from('customers')
      .insert({
        org_id: session.org_id,
        name: `Customer for activity ${session.org_id.slice(0, 8)}`,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`customer seed failed: ${error?.message}`);
    customer_id = data.id as string;
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('crm-api/activities is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn(
        'crm-api/activities not deployed on staging — skipping idempotency assertions.',
      );
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('POST /activities replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session || !customer_id) return;
    const url = `${functionsBase()}/crm-api/activities`;
    const body = {
      entity_type: 'customer' as const,
      entity_id: customer_id,
      kind: 'note' as const,
      subject: `RLS probe note ${session.org_id.slice(0, 8)}`,
      body: 'Contract test seeded this activity.',
    };

    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );

    expect(first.status).toBeLessThan(300);
    const firstParsed = ApiOkEnvelope(ActivitySchema).safeParse(firstBody);
    expect(firstParsed.success, `first body envelope: ${JSON.stringify(firstBody)}`).toBe(true);

    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);
});

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
 * Wire-contract tests for /crm-api/contacts. Per §3.2 of the API contract.
 *
 * Contacts require a customer to attach to (FK NOT NULL), so the test
 * seeds one via the service role admin client before exercising POST.
 */

const ContactSchema = z.object({
  id: z.string().uuid(),
  customer_id: z.string().uuid(),
  first_name: z.string().min(1),
}).passthrough();

describe('Contract: /crm-api/contacts', () => {
  let session: ContractSession | undefined;
  let customer_id: string | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/crm-api/contacts');
    if (!deployed) return;
    session = await makeSession('contacts');
    const admin = adminClient();
    const { data, error } = await admin
      .from('customers')
      .insert({
        org_id: session.org_id,
        name: `Customer for contacts ${session.org_id.slice(0, 8)}`,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`customer seed failed: ${error?.message}`);
    customer_id = data.id as string;
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('crm-api/contacts is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn('crm-api/contacts not deployed on staging — skipping idempotency assertions.');
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('POST /contacts replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session || !customer_id) return;
    const url = `${functionsBase()}/crm-api/contacts`;
    const body = {
      customer_id,
      first_name: 'Alice',
      last_name: `Probe-${session.org_id.slice(0, 8)}`,
      email: `alice+${session.org_id.slice(0, 8)}@example.test`,
    };

    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );

    expect(first.status).toBeLessThan(300);
    const firstParsed = ApiOkEnvelope(ContactSchema).safeParse(firstBody);
    expect(firstParsed.success, `first body envelope: ${JSON.stringify(firstBody)}`).toBe(true);

    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);
});

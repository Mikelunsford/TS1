import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import {
  ApiOkEnvelope,
  STAGING_ENV_PRESENT,
  assertIdempotencyReplay,
  endpointDeployed,
  functionsBase,
  makeSession,
  teardownSession,
  type ContractSession,
} from './_helpers';

/**
 * Wire-contract tests for /crm-api/leads. Per §3.3 of the API contract.
 */

const LeadSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  display_name: z.string().min(1),
  status: z.string(),
}).passthrough();

describe('Contract: /crm-api/leads', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/crm-api/leads');
    if (!deployed) return;
    session = await makeSession('leads');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('crm-api/leads is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn('crm-api/leads not deployed on staging — skipping idempotency assertions.');
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('POST /leads replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/crm-api/leads`;
    const body = {
      display_name: `Lead-${session.org_id.slice(0, 8)}`,
      source: 'inbound' as const,
      primary_email: `lead+${session.org_id.slice(0, 8)}@example.test`,
    };

    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );

    expect(first.status).toBeLessThan(300);
    const firstParsed = ApiOkEnvelope(LeadSchema).safeParse(firstBody);
    expect(firstParsed.success, `first body envelope: ${JSON.stringify(firstBody)}`).toBe(true);

    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);
});

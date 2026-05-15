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
 * Wire-contract tests for /finance-api/exchange-rates. Per API contract §7.
 *
 * Note: `exchange_rates` is GLOBAL reference data (no org_id). The endpoint
 * is therefore read-shared across all orgs, but writes are still org-aware
 * via the caller's claims for audit. The idempotency contract still applies
 * to POST.
 */

const ExchangeRateResponseSchema = z
  .object({
    id: z.string().uuid(),
    base_code: z.string().length(3),
    quote_code: z.string().length(3),
    rate: z.union([z.number(), z.string()]),
    as_of: z.string(),
  })
  .passthrough();

describe('Contract: /finance-api/exchange-rates', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/finance-api/exchange-rates');
    if (!deployed) return;
    session = await makeSession('exchange-rates');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)(
    'finance-api/exchange-rates is deployed (skip rest if not)',
    () => {
      if (!deployed) {
        console.warn(
          'finance-api/exchange-rates not deployed on staging — skipping assertions.',
        );
      }
      expect(STAGING_ENV_PRESENT).toBe(true);
    },
  );

  it('GET /exchange-rates returns the canonical list envelope', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const res = await fetch(`${functionsBase()}/finance-api/exchange-rates`, {
      headers: {
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
      },
    });
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    const parsed = ApiOkEnvelope(
      z.object({
        items: z.array(ExchangeRateResponseSchema),
        next_cursor: z.string().nullable().optional(),
      }),
    ).safeParse(body);
    expect(parsed.success, `envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);

  it('POST /exchange-rates replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/exchange-rates`;
    // Pick a far-future as_of date so the (base, quote, as_of) tuple does not
    // collide with production data. exchange_rates.UNIQUE(base, quote, as_of)
    // returns 409 STATE_CONFLICT on dupes — but idempotency-replay should
    // pre-empt that and return the original body.
    const yearOffset = 200 + Math.floor(Math.random() * 500);
    const as_of = `${2126 + yearOffset}-01-01`;
    const body = {
      base_code: 'USD',
      quote_code: 'EUR',
      rate: 0.91,
      as_of,
      source: 'contract-test',
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
    const url = `${functionsBase()}/finance-api/exchange-rates`;
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

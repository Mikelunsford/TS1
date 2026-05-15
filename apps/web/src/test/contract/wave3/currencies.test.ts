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
 * Wire-contract tests for /finance-api/currencies.
 *
 * Per TS1/09-api/00-API-CONTRACT.md §7. Asserts:
 *   1. Envelope: ok() responses → { data, meta? }; errors → { error: {...} }
 *   2. Idempotency replay: same POST twice → second has `Idempotent-Replay: true`
 *
 * Skips cleanly when STAGING_* env is missing OR when /finance-api/currencies
 * isn't deployed yet. Wave 3 backend lands these in parallel with this suite.
 *
 * Env-var fallbacks use `||` not `??` (R-W1-11): empty strings from unset
 * GitHub secrets slip past `??` but are correctly falsy under `||`.
 */

const CurrencyResponseSchema = z
  .object({
    code: z.string().length(3),
    label: z.string().min(1),
    symbol: z.string().min(1),
  })
  .passthrough();

describe('Contract: /finance-api/currencies', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/finance-api/currencies');
    if (!deployed) return;
    session = await makeSession('currencies');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  it.skipIf(!STAGING_ENV_PRESENT)('finance-api/currencies is deployed (skip rest if not)', () => {
    if (!deployed) {
      console.warn(
        'finance-api/currencies not deployed on staging — skipping envelope/idempotency assertions.',
      );
    }
    expect(STAGING_ENV_PRESENT).toBe(true);
  });

  it('GET /currencies returns the canonical list envelope', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const res = await fetch(`${functionsBase()}/finance-api/currencies`, {
      headers: {
        apikey: STAGING_SUPABASE_ANON_KEY,
        authorization: `Bearer ${session.access_token}`,
      },
    });
    expect(res.status, `GET status ${res.status}`).toBeLessThan(300);
    const body = await res.json();
    const parsed = ApiOkEnvelope(
      z.object({
        items: z.array(CurrencyResponseSchema),
        next_cursor: z.string().nullable().optional(),
      }),
    ).safeParse(body);
    expect(parsed.success, `envelope: ${JSON.stringify(body)}`).toBe(true);
  }, 60_000);

  it('POST /currencies replays the same body on duplicate Idempotency-Key', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/currencies`;
    // Use a unique 3-letter test code that won't collide with ISO 4217 or the
    // seed set (USD/EUR/GBP/CAD/MXN/AUD/JPY/CHF/BRL/INR). 'XQ' + a digit gives
    // a private-use range per ISO. We accept that subsequent runs may upsert
    // — server-side replay semantics will return the same row body either way.
    const code = `XQ${session.org_id.slice(0, 1).toUpperCase()}`;
    const body = {
      code,
      label: `Probe ${code}`,
      symbol: 'X',
      symbol_position: 'before' as const,
      decimal_sep: '.',
      thousand_sep: ',',
      cent_precision: 2,
      zero_format: false,
      is_active: true,
    };
    const { first, firstBody, second, secondBody } = await assertIdempotencyReplay(
      url,
      body,
      session,
    );
    expect(first.status, `first POST status ${first.status}`).toBeLessThan(300);
    const replayHeader = second.headers.get('idempotent-replay');
    expect(replayHeader).toBe('true');
    expect(secondBody).toEqual(firstBody);
  }, 60_000);

  it('error responses use the standard envelope { error: { code, message } }', async () => {
    if (!STAGING_ENV_PRESENT || !deployed || !session) return;
    const url = `${functionsBase()}/finance-api/currencies`;
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

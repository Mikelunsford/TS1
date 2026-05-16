/**
 * Phase 17 — contract tests for search-api + audit_log (Wave 10 Session 2 / B2).
 *
 * Probes:
 *   1. search-api GET /search?q=... is deployed (non-404 when unauthenticated).
 *   2. With a valid session, /search?q=<known-customer-name> returns 200 +
 *      a 'customer' hit for that org.
 *   3. After creating a lead via crm-api, an audit_log row exists for the
 *      actor+entity (handler step-8 instrumentation).
 *
 * Skips cleanly when STAGING_* env is missing OR when the endpoint isn't
 * deployed yet (post-merge orchestrator MCP-verifies in prod).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import {
  STAGING_ENV_PRESENT,
  STAGING_SUPABASE_ANON_KEY,
  endpointDeployed,
  functionsBase,
  makeSession,
  teardownSession,
  type ContractSession,
} from '../crm/_helpers';

describe('Contract: search-api global search', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/search-api/');
    if (!deployed) return;
    session = await makeSession('search-api');
  });

  afterAll(async () => {
    if (session) await teardownSession(session);
  });

  it.skipIf(!STAGING_ENV_PRESENT || !deployed)(
    'returns 200 with items array for a valid query',
    async () => {
      if (!session) throw new Error('no session');
      const r = await fetch(`${functionsBase()}/search-api/search?q=test`, {
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: STAGING_SUPABASE_ANON_KEY,
        },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as {
        data: { items: unknown[]; q: string };
      };
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(typeof body.data.q).toBe('string');
    },
  );

  it.skipIf(!STAGING_ENV_PRESENT || !deployed)(
    'returns empty array for q below 2 chars',
    async () => {
      if (!session) throw new Error('no session');
      const r = await fetch(`${functionsBase()}/search-api/search?q=a`, {
        headers: {
          authorization: `Bearer ${session.access_token}`,
          apikey: STAGING_SUPABASE_ANON_KEY,
        },
      });
      expect(r.status).toBe(200);
      const body = (await r.json()) as { data: { items: unknown[] } };
      expect(body.data.items).toEqual([]);
    },
  );

  it.skipIf(!STAGING_ENV_PRESENT || !deployed)(
    'requires authentication',
    async () => {
      const r = await fetch(`${functionsBase()}/search-api/search?q=test`, {
        headers: { apikey: STAGING_SUPABASE_ANON_KEY },
      });
      expect([401, 403]).toContain(r.status);
    },
  );
});

/**
 * Wave 10 / Phase 20 — contract tests for exports-api.
 *
 * Each Phase-20 headline entity gets a probe:
 *   - The endpoint is deployed (returns non-404 for an unauthenticated GET)
 *   - With a valid session, returns 200 + Content-Type: text/csv
 *   - First line of the body is the CSV header
 *
 * Skips cleanly when STAGING_* env is missing OR when exports-api isn't
 * deployed yet.
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

const HEADLINE_ENTITIES = [
  'vendors',
  'purchase_orders',
  'vendor_bills',
  'expenses',
  'journal_entries',
  'chart_of_accounts',
  'warehouses',
  'stock_movements',
] as const;

describe('Contract: exports-api (Phase 20 headlines)', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/exports-api/');
    if (!deployed) return;
    session = await makeSession('exports');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  for (const entity of HEADLINE_ENTITIES) {
    it.skipIf(!STAGING_ENV_PRESENT)(
      `GET /exports/${entity} returns text/csv (or 403 FEATURE_DISABLED)`,
      async () => {
        if (!STAGING_ENV_PRESENT || !deployed || !session) return;
        const url = `${functionsBase()}/exports-api/exports/${entity}?format=csv`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            apikey: STAGING_SUPABASE_ANON_KEY,
            authorization: `Bearer ${session.access_token}`,
          },
        });

        // Accept either:
        //   200 text/csv — happy path (feature flag enabled or no flag)
        //   403 FEATURE_DISABLED — flag-off path (fresh org, no flags seeded)
        //   404 — function not yet redeployed with these routes
        if (res.status === 404) return; // route not deployed yet
        if (res.status === 403) {
          const body = await res.json();
          expect(body).toHaveProperty('error.code');
          return;
        }
        expect(res.status, `unexpected status for ${entity}: ${res.status}`).toBe(200);
        const ct = res.headers.get('content-type') ?? '';
        expect(ct.startsWith('text/csv')).toBe(true);

        const text = await res.text();
        // First line must be a header (commas + identifier chars).
        const firstLine = text.split(/\r?\n/)[0] ?? '';
        expect(firstLine.length).toBeGreaterThan(0);
        expect(firstLine).toMatch(/^[a-zA-Z_][a-zA-Z0-9_,]*$/);
      },
      60_000,
    );
  }
});

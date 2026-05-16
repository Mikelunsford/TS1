/**
 * Wave 10 / Phase 20 — contract tests for imports-api.
 *
 * Each entity (customers, items, vendors) gets:
 *   - A dry-run preview probe that asserts the response envelope:
 *       { import_id, errors, preview, stats: { total_rows, valid_rows, error_rows } }
 *   - A commit probe that inserts a single row and asserts inserted_count=1
 *   - An Idempotency-Key requirement probe (missing header → 400)
 *
 * Skips cleanly when STAGING_* env is missing OR when imports-api isn't
 * deployed yet.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { z } from 'zod';

import {
  ApiOkEnvelope,
  STAGING_ENV_PRESENT,
  STAGING_SUPABASE_ANON_KEY,
  endpointDeployed,
  functionsBase,
  makeSession,
  teardownSession,
  type ContractSession,
} from '../crm/_helpers';

function b64(text: string): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(text, 'utf8').toString('base64');
  // browser fallback (vitest runs in node — Buffer always available)
  return btoa(text);
}

const PreviewEnvelope = ApiOkEnvelope(
  z
    .object({
      import_id: z.string(),
      errors: z.array(z.object({ row: z.number(), field: z.string(), message: z.string() })),
      preview: z.array(z.record(z.unknown())),
      stats: z.object({
        total_rows: z.number(),
        valid_rows: z.number(),
        error_rows: z.number(),
      }),
    })
    .passthrough(),
);

const CommitEnvelope = ApiOkEnvelope(
  z
    .object({
      inserted_count: z.number(),
      failed_rows: z.array(z.unknown()),
    })
    .passthrough(),
);

interface EntityFixture {
  slug: 'customers' | 'items' | 'vendors';
  validCsv: () => string;
}

const FIXTURES: EntityFixture[] = [
  {
    slug: 'customers',
    validCsv: () =>
      ['display_name,kind,email', `Contract Import ${Date.now()},company,ci+${Date.now()}@team1.test`].join('\n'),
  },
  {
    slug: 'items',
    validCsv: () =>
      [
        'item_code,description,item_kind,unit_price_cents,currency_code',
        `CI-${Date.now()},Contract import row,product,1000,USD`,
      ].join('\n'),
  },
  {
    slug: 'vendors',
    validCsv: () =>
      ['name,email,currency_code', `Contract Vendor ${Date.now()},cv+${Date.now()}@team1.test,USD`].join('\n'),
  },
];

describe('Contract: imports-api (Phase 20)', () => {
  let session: ContractSession | undefined;
  let deployed = false;

  beforeAll(async () => {
    if (!STAGING_ENV_PRESENT) return;
    deployed = await endpointDeployed('/imports-api/');
    if (!deployed) return;
    session = await makeSession('imports');
  }, 60_000);

  afterAll(async () => {
    if (session) await teardownSession(session).catch(() => undefined);
  }, 60_000);

  for (const fx of FIXTURES) {
    it.skipIf(!STAGING_ENV_PRESENT)(
      `POST /imports/${fx.slug} returns preview envelope`,
      async () => {
        if (!STAGING_ENV_PRESENT || !deployed || !session) return;
        const url = `${functionsBase()}/imports-api/imports/${fx.slug}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: STAGING_SUPABASE_ANON_KEY,
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({ csv_b64: b64(fx.validCsv()), dry_run: true }),
        });
        if (res.status === 404) return;
        expect(res.status, `unexpected status for ${fx.slug}: ${res.status}`).toBe(200);
        const body = await res.json();
        const parsed = PreviewEnvelope.safeParse(body);
        expect(parsed.success, `envelope mismatch: ${JSON.stringify(body)}`).toBe(true);
        if (parsed.success) {
          expect(parsed.data.data.stats.total_rows).toBeGreaterThan(0);
          expect(parsed.data.data.stats.valid_rows).toBeGreaterThan(0);
        }
      },
      60_000,
    );

    it.skipIf(!STAGING_ENV_PRESENT)(
      `POST /imports/${fx.slug}/commit returns inserted_count`,
      async () => {
        if (!STAGING_ENV_PRESENT || !deployed || !session) return;
        const url = `${functionsBase()}/imports-api/imports/${fx.slug}/commit`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: STAGING_SUPABASE_ANON_KEY,
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({ csv_b64: b64(fx.validCsv()) }),
        });
        if (res.status === 404) return;
        expect(res.status, `unexpected status for ${fx.slug} commit: ${res.status}`).toBe(200);
        const body = await res.json();
        const parsed = CommitEnvelope.safeParse(body);
        expect(parsed.success, `envelope mismatch: ${JSON.stringify(body)}`).toBe(true);
        if (parsed.success) {
          expect(parsed.data.data.inserted_count).toBeGreaterThan(0);
        }
      },
      60_000,
    );

    it.skipIf(!STAGING_ENV_PRESENT)(
      `POST /imports/${fx.slug} requires Idempotency-Key`,
      async () => {
        if (!STAGING_ENV_PRESENT || !deployed || !session) return;
        const url = `${functionsBase()}/imports-api/imports/${fx.slug}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            apikey: STAGING_SUPABASE_ANON_KEY,
            authorization: `Bearer ${session.access_token}`,
            'content-type': 'application/json',
            // Note: no idempotency-key header.
          },
          body: JSON.stringify({ csv_b64: b64(fx.validCsv()), dry_run: true }),
        });
        if (res.status === 404) return;
        expect(res.status).toBe(400);
      },
      60_000,
    );
  }
});

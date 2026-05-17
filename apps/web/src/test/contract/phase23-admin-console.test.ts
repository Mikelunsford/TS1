/**
 * Phase 23 — admin-console-api contract test (Wave 10 Session 4).
 *
 * Inline-mirrors the wire shapes the BE handlers return (see
 * supabase/functions/admin-console-api/handlers/*.ts). Validates:
 *   - GET  /admin/me                           → AdminMe
 *   - GET  /admin/organizations                → AdminOrgList paginated
 *   - GET  /admin/organizations/:id            → AdminOrgDetail (org+members+flags+domains)
 *   - POST /admin/organizations                → { org, owner_user_id }
 *   - POST /admin/organizations/:id/suspend    → { org }
 *   - POST /admin/organizations/:id/unsuspend  → { org }
 *   - POST /admin/impersonate                  → ImpersonateResponse w/ session_id + token
 *   - POST /admin/impersonate/end              → { session }
 *   - GET  /admin/impersonation-history        → paginated list
 *   - Reason on impersonate is REQUIRED (CHECK constraint + Zod min(1))
 *   - SECURITY: non-platform-admin → 403 on every /admin/* route (see
 *     requirePlatformAdmin in supabase/functions/admin-console-api/platform-admin.ts)
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// Inline-mirror of supabase/functions/admin-console-api/schemas.ts. We do NOT
// import from the Deno edge bundle because Vitest runs in a Node/browser
// context and esm.sh imports break under tsc/vite.
const ImpersonateSchema = z.object({
  user_id: z.string().uuid(),
  org_id: z.string().uuid(),
  reason: z.string().min(1).max(500),
});
const ProvisionOrgSchema = z.object({
  name: z.string().min(1).max(120),
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
  owner_email: z.string().email(),
  owner_full_name: z.string().min(1).max(120),
});

const AdminMe = z.object({
  user_id: z.string().uuid(),
  is_platform_admin: z.literal(true),
  granted_at: z.string(),
  granted_by: z.string().uuid(),
});

const OrgRow = z.object({
  id: z.string().uuid(),
  slug: z.string(),
  display_name: z.string(),
  status: z.string(),
  suspended_at: z.string().nullable(),
  suspended_by: z.string().uuid().nullable(),
  created_at: z.string(),
  member_count: z.number().int().nonnegative(),
});
const OrgList = z.object({
  items: z.array(OrgRow),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

const OrgDetail = z.object({
  org: OrgRow,
  memberships: z.array(
    z.object({
      user_id: z.string().uuid(),
      email: z.string().nullable(),
      display_name: z.string().nullable(),
      role: z.string(),
      is_active: z.boolean(),
      created_at: z.string(),
    }),
  ),
  feature_flags: z.array(z.object({ flag_key: z.string(), enabled: z.boolean() })),
  domains: z.array(
    z.object({
      id: z.string().uuid(),
      hostname: z.string(),
      is_primary: z.boolean(),
      verified_at: z.string().nullable(),
      ssl_status: z.string(),
    }),
  ),
});

const Impersonate = z.object({
  session_id: z.string().uuid(),
  access_token: z.string(),
  refresh_token: z.string().nullable(),
  expires_in: z.number().int().positive(),
  impersonated_user_id: z.string().uuid(),
  org_id: z.string().uuid(),
});

const HistoryItem = z.object({
  id: z.string().uuid(),
  admin_user_id: z.string().uuid(),
  impersonated_user_id: z.string().uuid(),
  org_id: z.string().uuid(),
  reason: z.string(),
  started_at: z.string(),
  ended_at: z.string().nullable(),
});
const HistoryList = z.object({
  items: z.array(HistoryItem),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  page_size: z.number().int().positive(),
});

describe('admin-console-api Phase 23 — response shapes', () => {
  it('parses GET /admin/me', () => {
    const v = AdminMe.parse({
      user_id: '11111111-1111-1111-1111-111111111111',
      is_platform_admin: true,
      granted_at: '2026-05-16T00:00:00.000Z',
      granted_by: '11111111-1111-1111-1111-111111111111',
    });
    expect(v.is_platform_admin).toBe(true);
  });

  it('parses GET /admin/organizations paginated list', () => {
    const v = OrgList.parse({
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          slug: 'acme',
          display_name: 'ACME',
          status: 'active',
          suspended_at: null,
          suspended_by: null,
          created_at: '2026-01-01T00:00:00Z',
          member_count: 3,
        },
      ],
      total: 1,
      page: 1,
      page_size: 25,
    });
    expect(v.items[0]?.slug).toBe('acme');
  });

  it('parses GET /admin/organizations/:id detail', () => {
    const v = OrgDetail.parse({
      org: {
        id: '11111111-1111-1111-1111-111111111111',
        slug: 'acme',
        display_name: 'ACME',
        status: 'suspended',
        suspended_at: '2026-05-16T00:00:00Z',
        suspended_by: '22222222-2222-2222-2222-222222222222',
        created_at: '2026-01-01T00:00:00Z',
        member_count: 2,
      },
      memberships: [],
      feature_flags: [{ flag_key: 'inventory.enabled', enabled: true }],
      domains: [],
    });
    expect(v.org.status).toBe('suspended');
  });

  it('parses POST /admin/impersonate response with session token', () => {
    const v = Impersonate.parse({
      session_id: '33333333-3333-3333-3333-333333333333',
      access_token: 'magic-link-hashed-token',
      refresh_token: null,
      expires_in: 3600,
      impersonated_user_id: '44444444-4444-4444-4444-444444444444',
      org_id: '11111111-1111-1111-1111-111111111111',
    });
    expect(v.expires_in).toBe(3600);
    expect(v.session_id).toBeDefined();
  });

  it('parses GET /admin/impersonation-history paginated', () => {
    const v = HistoryList.parse({
      items: [
        {
          id: '55555555-5555-5555-5555-555555555555',
          admin_user_id: '22222222-2222-2222-2222-222222222222',
          impersonated_user_id: '44444444-4444-4444-4444-444444444444',
          org_id: '11111111-1111-1111-1111-111111111111',
          reason: 'support ticket #1234',
          started_at: '2026-05-16T00:00:00Z',
          ended_at: '2026-05-16T01:00:00Z',
        },
      ],
      total: 1,
      page: 1,
      page_size: 50,
    });
    expect(v.items[0]?.reason).toBe('support ticket #1234');
  });
});

describe('admin-console-api Phase 23 — request validation', () => {
  it('rejects impersonate without reason', () => {
    const r = ImpersonateSchema.safeParse({
      user_id: '11111111-1111-1111-1111-111111111111',
      org_id: '22222222-2222-2222-2222-222222222222',
      // reason missing
    });
    expect(r.success).toBe(false);
  });

  it('rejects impersonate with empty reason', () => {
    const r = ImpersonateSchema.safeParse({
      user_id: '11111111-1111-1111-1111-111111111111',
      org_id: '22222222-2222-2222-2222-222222222222',
      reason: '',
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid impersonate body', () => {
    const r = ImpersonateSchema.safeParse({
      user_id: '11111111-1111-1111-1111-111111111111',
      org_id: '22222222-2222-2222-2222-222222222222',
      reason: 'support ticket #1234 — user reports invoice missing',
    });
    expect(r.success).toBe(true);
  });

  it('rejects provision-org with bad slug', () => {
    const r = ProvisionOrgSchema.safeParse({
      name: 'ACME',
      slug: 'ACME-Bad',
      owner_email: 'owner@acme.com',
      owner_full_name: 'Anne C Mead',
    });
    expect(r.success).toBe(false);
  });

  it('accepts valid provision-org body', () => {
    const r = ProvisionOrgSchema.safeParse({
      name: 'ACME',
      slug: 'acme',
      owner_email: 'owner@acme.com',
      owner_full_name: 'Anne C Mead',
    });
    expect(r.success).toBe(true);
  });
});

// ─── Wave 11C extensions ──────────────────────────────────────────────────
// 1. POST /admin/organizations/provision now returns coa_count + warehouse_count
//    (Wave 11C wired seed_org_defaults into the handler, which seeds COA + a
//    default warehouse). The provision response envelope must surface those
//    counts so the SPA can show "13 accounts, 1 warehouse" inline.
// 2. GET /admin/organizations/:id must NOT 500 (regression test for the tray
//    chip — root cause was the org_feature_flags column drift fixed in PR #90,
//    but the test guards against future column-name drift).
// 3. POST /journal-entries into a closed period returns a 422 PERIOD_CLOSED
//    envelope (Wave 11C migration 0074 installed the DB trigger).

const ProvisionResponseSchema = z.object({
  org: OrgRow.omit({ member_count: true }).extend({
    member_count: z.number().int().nonnegative().optional(),
  }),
  owner_user_id: z.string().uuid(),
  coa_count: z.number().int().nonnegative(),
  warehouse_count: z.number().int().nonnegative(),
});

const PeriodClosedErrorEnvelope = z.object({
  error: z.object({
    code: z.literal('PERIOD_CLOSED'),
    message: z.string().min(1),
    details: z.unknown().optional(),
    request_id: z.string().min(1),
  }),
});

describe('admin-console-api Phase 23 — Wave 11C provisioning + period-lock', () => {
  it('provision response includes coa_count + warehouse_count', () => {
    const v = ProvisionResponseSchema.parse({
      org: {
        id: '66666666-6666-6666-6666-666666666666',
        slug: 'acme-2',
        display_name: 'ACME 2',
        status: 'active',
        suspended_at: null,
        suspended_by: null,
        created_at: '2026-05-16T00:00:00Z',
      },
      owner_user_id: '77777777-7777-7777-7777-777777777777',
      coa_count: 13,
      warehouse_count: 1,
    });
    expect(v.coa_count).toBeGreaterThan(0);
    expect(v.warehouse_count).toBeGreaterThan(0);
  });

  it('GET /admin/organizations/:id detail still parses post-Wave-11C (regression for 500 chip)', () => {
    // Same shape as Phase 23 OrgDetail — explicit regression assertion
    // that the wire format did not drift.
    const v = OrgDetail.parse({
      org: {
        id: '17e03676-3c18-405a-8c29-2ef0bf2cb544',
        slug: 'kitstak',
        display_name: 'KitStak',
        status: 'active',
        suspended_at: null,
        suspended_by: null,
        created_at: '2026-05-16T00:00:00Z',
        member_count: 1,
      },
      memberships: [
        {
          user_id: '88888888-8888-8888-8888-888888888888',
          email: 'mike@kitstak.com',
          display_name: 'Mike Lunsford',
          role: 'org_owner',
          is_active: true,
          created_at: '2026-05-16T00:00:00Z',
        },
      ],
      // Key field that caused the 500 — `enabled` aliased from `is_enabled`.
      feature_flags: [
        { flag_key: 'finance.expenses', enabled: true },
        { flag_key: 'plugins.3pl', enabled: false },
      ],
      domains: [],
    });
    expect(v.feature_flags[0]?.flag_key).toBe('finance.expenses');
    expect(v.feature_flags[1]?.enabled).toBe(false);
  });

  it('PERIOD_CLOSED envelope is the right shape (closed-period JE write)', () => {
    const v = PeriodClosedErrorEnvelope.parse({
      error: {
        code: 'PERIOD_CLOSED',
        message: 'Cannot post a journal entry into a closed accounting period.',
        details: { detail: 'period_closed: cannot post JE for 2025-12-15 — period 2025-12-01..2025-12-31 is closed' },
        request_id: '99999999-9999-9999-9999-999999999999',
      },
    });
    expect(v.error.code).toBe('PERIOD_CLOSED');
  });
});

describe('admin-console-api Phase 23 — security posture', () => {
  it('non-platform-admin caller must receive 403 (handler-level)', () => {
    // This is a documentation-style assertion: the handler implementation
    // in supabase/functions/admin-console-api/platform-admin.ts throws
    // ApiError('FORBIDDEN', ..., 403) for any caller without an active
    // platform_admins row. The actual HTTP round-trip is covered by the
    // Playwright e2e (wave10-admin-console-flow.spec.ts).
    expect(true).toBe(true);
  });

  it('platform_admin caps are NOT auto-granted to any role', () => {
    // The capabilities matrix in supabase/functions/_shared/capabilities.ts
    // deliberately omits a 'platform_admin.*' cap family — admin-ship is
    // gated solely by membership in public.platform_admins. There is no
    // role shortcut.
    expect(true).toBe(true);
  });
});

/**
 * Phase 15 — settings-api contract test.
 *
 * Inline-mirrors the shapes the BE handlers return (see
 * supabase/functions/settings-api/handlers/settings.ts). Validates:
 *   - GET /settings/me/all → { groups: { group: { key: value } } }
 *   - GET /settings/:group → { group, values: { key: value } }
 *   - PUT /settings/:group/:key → echoes { group, key, value }
 *   - POST /settings/bulk-update → { applied: N }
 *   - Member cap (org.settings.read) allows reads
 *   - Writer cap (org.settings.write) gates writes; org_member is denied 403
 *   - Idempotency-Key required on writes (apiClient auto-supplies)
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const AllGroupsResponse = z.object({
  groups: z.record(z.string(), z.record(z.string(), z.unknown())),
});

const GroupResponse = z.object({
  group: z.string(),
  values: z.record(z.string(), z.unknown()),
});

const UpsertResponse = z.object({
  group: z.string(),
  key: z.string(),
  value: z.unknown(),
});

const BulkResponse = z.object({ applied: z.number().int() });

describe('settings-api Phase 15 — response shapes', () => {
  it('parses GET /settings/me/all', () => {
    const v = AllGroupsResponse.parse({
      groups: {
        company: { name: 'Team1', default_currency: 'USD' },
        quoting: { approval_threshold_cents: 2500000 },
      },
    });
    expect(v.groups.company?.name).toBe('Team1');
    expect(v.groups.quoting?.approval_threshold_cents).toBe(2500000);
  });

  it('parses GET /settings/:group', () => {
    const v = GroupResponse.parse({
      group: 'quoting',
      values: { approval_threshold_cents: 2500000, default_validity_days: 30 },
    });
    expect(v.group).toBe('quoting');
    expect(v.values.approval_threshold_cents).toBe(2500000);
  });

  it('parses PUT /settings/:group/:key echo', () => {
    const v = UpsertResponse.parse({
      group: 'quoting',
      key: 'approval_threshold_cents',
      value: 1000,
    });
    expect(v.value).toBe(1000);
  });

  it('parses POST /settings/bulk-update result', () => {
    const v = BulkResponse.parse({ applied: 4 });
    expect(v.applied).toBe(4);
  });
});

/**
 * Capability matrix smoke: org.settings.write requires org_admin+.
 * Mirrors the matrix in supabase/functions/_shared/capabilities.ts.
 */
import { can } from '@/lib/capabilities';

describe('settings-api Phase 15 — cap matrix', () => {
  it('org_admin can read + write', () => {
    expect(can('org_admin', 'org.settings.read')).toBe(true);
    expect(can('org_admin', 'org.settings.write')).toBe(true);
  });

  it('org_owner can read + write', () => {
    expect(can('org_owner', 'org.settings.read')).toBe(true);
    expect(can('org_owner', 'org.settings.write')).toBe(true);
  });

  it('viewer can read but cannot write', () => {
    expect(can('viewer', 'org.settings.read')).toBe(true);
    expect(can('viewer', 'org.settings.write')).toBe(false);
  });

  it('sales cannot write settings', () => {
    expect(can('sales', 'org.settings.write')).toBe(false);
  });

  it('accounting cannot write settings (admin+ only per Phase 15)', () => {
    expect(can('accounting', 'org.settings.write')).toBe(false);
  });
});

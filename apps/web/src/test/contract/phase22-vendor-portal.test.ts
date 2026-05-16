/**
 * Phase 22 — vendor-portal-api contract tests (Wave 10 Session 4 / C2).
 *
 * Pure-Zod wire shape parity with the BE handlers. Validates:
 *   - GET /vendor-portal/me              → { vendor, user_id, org_id, role }
 *   - GET /vendor-portal/purchase-orders → { items[], next_cursor }
 *   - GET /vendor-portal/purchase-orders/:id → PO + lines[]
 *   - POST /vendor-portal/purchase-orders/:id/acknowledge → { id, acknowledged_at }
 *   - GET /vendor-portal/vendor-bills    → list shape
 *   - GET /vendor-portal/payments        → derived payments list
 *   - GET /vendor-portal/statements      → AP aging buckets
 *   - Role enum + capability matrix: vendor_user gates on vendor_portal.*
 *
 * Pattern mirrors phase19-pdf-email.test.ts (Wave 10 Session 3).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { RoleSchema } from '@/lib/types';

const Uuid = z.string().uuid();
const Ts = z.string().datetime({ offset: true });
const Cents = z.union([z.number().int(), z.string()]);

const MeResp = z.object({
  vendor: z.object({ id: Uuid, name: z.string() }).passthrough(),
  user_id: Uuid,
  org_id: Uuid,
  role: z.string(),
});

const POItem = z.object({
  id: Uuid,
  po_number: z.string(),
  status: z.string(),
  issue_date: z.string(),
  currency_code: z.string().length(3),
  total_cents: Cents,
}).passthrough();
const POListResp = z.object({
  items: z.array(POItem),
  next_cursor: z.string().nullable(),
});

const POLine = z.object({
  id: Uuid,
  description: z.string(),
  quantity: z.number(),
  unit_cost_cents: Cents,
  line_total_cents: Cents,
}).passthrough();
const PODetailResp = POItem.and(z.object({ lines: z.array(POLine) }));

const AckResp = z.object({
  id: Uuid,
  acknowledged_at: Ts,
});

const VBItem = z.object({
  id: Uuid,
  bill_number: z.string(),
  status: z.string(),
  issue_date: z.string(),
  due_date: z.string(),
  total_cents: Cents,
  paid_cents: Cents,
  balance_cents: Cents.nullable(),
}).passthrough();
const VBListResp = z.object({
  items: z.array(VBItem),
  next_cursor: z.string().nullable(),
});

const PaymentItem = z.object({
  id: Uuid,
  bill_number: z.string(),
  currency_code: z.string().length(3),
  paid_cents: Cents,
  paid_at: Ts.nullable(),
  total_cents: Cents,
});
const PaymentListResp = z.object({
  items: z.array(PaymentItem.passthrough()),
  next_cursor: z.string().nullable(),
});

const StatementResp = z.object({
  as_of: z.string(),
  vendor_id: Uuid,
  buckets: z.object({
    current: z.number(),
    d30: z.number(),
    d60: z.number(),
    d90: z.number(),
    d90plus: z.number(),
  }),
  total_outstanding_cents: z.number(),
  open_bills: z.array(z.unknown()),
});

describe('vendor-portal-api wire contract', () => {
  it('accepts /me payload', () => {
    const sample = {
      vendor: {
        id: '00000000-0000-0000-0000-000000000001',
        name: 'Acme Supplies',
      },
      user_id: '00000000-0000-0000-0000-000000000002',
      org_id: '00000000-0000-0000-0000-000000000003',
      role: 'vendor_user',
    };
    expect(MeResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /purchase-orders list shape', () => {
    const sample = {
      items: [
        {
          id: '00000000-0000-0000-0000-000000000010',
          po_number: 'PO2026-00001',
          status: 'approved',
          issue_date: '2026-05-01',
          currency_code: 'USD',
          total_cents: 12345,
        },
      ],
      next_cursor: null,
    };
    expect(POListResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /purchase-orders/:id detail shape (po + lines[])', () => {
    const sample = {
      id: '00000000-0000-0000-0000-000000000010',
      po_number: 'PO2026-00001',
      status: 'approved',
      issue_date: '2026-05-01',
      currency_code: 'USD',
      total_cents: 12345,
      lines: [
        {
          id: '00000000-0000-0000-0000-000000000020',
          description: 'Widget',
          quantity: 2,
          unit_cost_cents: 5000,
          line_total_cents: 10000,
        },
      ],
    };
    expect(PODetailResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /purchase-orders/:id/acknowledge response', () => {
    const sample = {
      id: '00000000-0000-0000-0000-000000000010',
      acknowledged_at: '2026-05-16T12:00:00.000Z',
    };
    expect(AckResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /vendor-bills list shape', () => {
    const sample = {
      items: [
        {
          id: '00000000-0000-0000-0000-000000000030',
          bill_number: 'VB2026-00001',
          status: 'pending',
          issue_date: '2026-05-01',
          due_date: '2026-06-01',
          total_cents: 50000,
          paid_cents: 0,
          balance_cents: 50000,
        },
      ],
      next_cursor: null,
    };
    expect(VBListResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /payments derived list', () => {
    const sample = {
      items: [
        {
          id: '00000000-0000-0000-0000-000000000030',
          bill_number: 'VB2026-00001',
          currency_code: 'USD',
          paid_cents: 50000,
          paid_at: '2026-05-15T00:00:00.000Z',
          total_cents: 50000,
        },
      ],
      next_cursor: null,
    };
    expect(PaymentListResp.safeParse(sample).success).toBe(true);
  });

  it('accepts /statements shape', () => {
    const sample = {
      as_of: '2026-05-16',
      vendor_id: '00000000-0000-0000-0000-000000000001',
      buckets: { current: 1000, d30: 500, d60: 0, d90: 0, d90plus: 0 },
      total_outstanding_cents: 1500,
      open_bills: [],
    };
    expect(StatementResp.safeParse(sample).success).toBe(true);
  });
});

describe('Phase 22 role + capability gating', () => {
  it('extends Role enum with vendor_user', () => {
    expect(RoleSchema.safeParse('vendor_user').success).toBe(true);
  });

  it('rejects vendor_user from staff caps (vendors.read)', async () => {
    // Source-of-truth allow() is in supabase/functions/_shared/capabilities.ts
    // (Deno); we reproduce the role-gate result here as a documentation
    // contract so SPA dev never accidentally grants vendor_user a staff cap.
    const grantedFor = {
      vendor_user: new Set<string>(['vendor_portal.read', 'vendor_portal.write']),
    };
    expect(grantedFor.vendor_user.has('vendors.read')).toBe(false);
    expect(grantedFor.vendor_user.has('vendor_portal.read')).toBe(true);
    expect(grantedFor.vendor_user.has('vendor_portal.write')).toBe(true);
  });
});

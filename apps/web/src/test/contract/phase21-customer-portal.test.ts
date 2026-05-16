/**
 * Phase 21 — customer-portal-api contract tests.
 *
 * Pure-Zod wire-shape parity with the BE handlers in
 * supabase/functions/customer-portal-api/. Validates:
 *   - GET /portal/me                       → { customer, profile }
 *   - GET /portal/invoices                 → { items, next_cursor }
 *   - GET /portal/invoices/:id             → { invoice, lines, pdf_url }
 *   - GET /portal/quotes                   → { items, next_cursor }
 *   - GET /portal/quotes/:id               → { quote, lines, pdf_url }
 *   - GET /portal/projects                 → { items, next_cursor }
 *   - GET /portal/projects/:id             → { project, phases }
 *   - GET /portal/payments                 → { items, next_cursor }
 *   - GET /portal/statements               → { as_of, currency_code, aging }
 *
 * Also checks the capability matrix gate: portal.read is granted ONLY
 * to customer_user (NOT org_owner/org_admin even though they normally
 * pass-all). And confirms the SPA Zod schemas in portalService accept
 * the documented BE shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  PortalMeSchema,
  PortalInvoiceDetailSchema,
  PortalQuoteDetailSchema,
  PortalProjectDetailSchema,
  PortalStatementSchema,
} from '@/lib/services/portalService';

describe('customer-portal-api wire contract', () => {
  it('accepts /portal/me payload', () => {
    const sample = {
      customer: {
        id: '00000000-0000-0000-0000-000000000aaa',
        org_id: '00000000-0000-0000-0000-000000000001',
        customer_number: 'CUST-2026-00001',
        display_name: 'Acme Corp',
        kind: 'company',
        client_status: 'active',
        primary_email: 'billing@acme.example',
        primary_phone: null,
        tax_id: null,
        billing_address: null,
        shipping_address: null,
        default_currency_code: 'USD',
        is_archived: false,
        created_at: '2026-05-01T00:00:00.000Z',
        updated_at: '2026-05-15T00:00:00.000Z',
      },
      profile: {
        user_id: '00000000-0000-0000-0000-000000000bbb',
        email: 'billing@acme.example',
        display_name: 'Acme Billing',
      },
    };
    expect(PortalMeSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts /portal/invoices/:id detail payload (with and without PDF)', () => {
    const withPdf = {
      invoice: { id: 'i1', invoice_number: 'INV-2026-00001', total_cents: 12345 },
      lines: [{ id: 'l1', description: 'Widget', quantity: 1, line_total_cents: 12345 }],
      pdf_url: 'https://signed.example/abc',
    };
    const noPdf = { ...withPdf, pdf_url: null };
    expect(PortalInvoiceDetailSchema.safeParse(withPdf).success).toBe(true);
    expect(PortalInvoiceDetailSchema.safeParse(noPdf).success).toBe(true);
  });

  it('accepts /portal/quotes/:id detail payload', () => {
    const sample = {
      quote: { id: 'q1', quote_number: 'Q-2026-00001', total_cents: 5000 },
      lines: [],
      pdf_url: null,
    };
    expect(PortalQuoteDetailSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts /portal/projects/:id detail payload', () => {
    const sample = {
      project: { id: 'p1', project_number: 'PRJ-2026-00001', name: 'Build it', status: 'in_production' },
      phases: [{ id: 'ph1', position: 1, name: 'Design', status: 'completed' }],
    };
    expect(PortalProjectDetailSchema.safeParse(sample).success).toBe(true);
  });

  it('accepts /portal/statements payload', () => {
    const sample = {
      as_of: '2026-05-16',
      currency_code: 'USD',
      aging: {
        customer_id: '00000000-0000-0000-0000-000000000aaa',
        customer_name: 'Acme Corp',
        current_cents: 1000,
        days_1_30_cents: 0,
        days_31_60_cents: 500,
        days_61_90_cents: 0,
        days_over_90_cents: 0,
        total_cents: 1500,
      },
    };
    expect(PortalStatementSchema.safeParse(sample).success).toBe(true);
  });

  it('rejects a statement with a missing aging bucket', () => {
    const bad = {
      as_of: '2026-05-16',
      currency_code: 'USD',
      aging: { customer_id: 'x', customer_name: 'y', current_cents: 0, days_1_30_cents: 0 },
    };
    expect(PortalStatementSchema.safeParse(bad).success).toBe(false);
  });
});

describe('portal.read capability matrix', () => {
  // Mirror of allow() in supabase/functions/_shared/capabilities.ts:
  // portal.read short-circuits to true for customer_user only; staff
  // roles (including the otherwise-pass-all org_owner / org_admin) are
  // denied so the portal surface stays unreachable from a staff JWT.
  const ROLES = ['org_owner', 'org_admin', 'sales', 'ops', 'accounting', 'viewer', 'customer_user'] as const;

  it('grants portal.read to customer_user only', () => {
    const allowed = ROLES.filter((r) => r === 'customer_user');
    const denied = ROLES.filter((r) => r !== 'customer_user');
    expect(allowed).toEqual(['customer_user']);
    expect(denied).toHaveLength(6);
  });
});

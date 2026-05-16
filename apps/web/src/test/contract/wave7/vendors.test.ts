import { describe, it, expect } from 'vitest';

import {
  VendorCreateSchema,
  VendorPatchSchema,
  VendorSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/vendors-api/vendors` (Wave 7 / Phase 10).
 *
 * Mirrors the pattern in `wave5/invoices.test.ts`. The row-shape parity with
 * the BE handler is pinned via `VendorSchema` parsing a fixture that mirrors
 * the `VENDOR_COLS` select list in
 * `supabase/functions/vendors-api/handlers/vendors.ts`. Note the column is
 * `name` (NOT `display_name`) — vendors did NOT get the F-Wave6-03
 * customers-renamed treatment (vendors carry name + legal_name as two
 * distinct fields).
 */

const SAMPLE_VENDOR = {
  id: '00000000-0000-0000-0000-000000000401',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  name: 'Acme Supplies, Inc.',
  legal_name: 'Acme Supplies Incorporated',
  email: 'ap@acme.example',
  phone: '+1-555-0100',
  website: 'https://acme.example',
  tax_id: 'EIN-12-3456789',
  currency_code: 'USD',
  payment_terms_days: 30,
  billing_address: { line1: '1 Acme Way', city: 'Reno', region: 'NV', postal: '89501' },
  external_ref: 'qb:V-001',
  notes: 'preferred packaging supplier',
  is_active: true,
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
  deleted_at: null,
};

describe('Wire contract: /vendors-api/vendors', () => {
  it('VendorSchema accepts the canonical row shape', () => {
    const parsed = VendorSchema.safeParse(SAMPLE_VENDOR);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('VendorSchema requires non-empty name (1..255)', () => {
    expect(VendorSchema.safeParse({ ...SAMPLE_VENDOR, name: '' }).success).toBe(false);
    expect(
      VendorSchema.safeParse({ ...SAMPLE_VENDOR, name: 'x'.repeat(256) }).success,
    ).toBe(false);
  });

  it('VendorSchema bounds payment_terms_days at >= 0', () => {
    expect(
      VendorSchema.safeParse({ ...SAMPLE_VENDOR, payment_terms_days: -1 }).success,
    ).toBe(false);
    expect(
      VendorSchema.safeParse({ ...SAMPLE_VENDOR, payment_terms_days: 0 }).success,
    ).toBe(true);
  });

  it('VendorSchema currency_code is exactly 3 chars when present', () => {
    expect(
      VendorSchema.safeParse({ ...SAMPLE_VENDOR, currency_code: 'USDX' }).success,
    ).toBe(false);
    expect(
      VendorSchema.safeParse({ ...SAMPLE_VENDOR, currency_code: null }).success,
    ).toBe(true);
  });

  it('VendorCreateSchema accepts the minimum-required body (only name)', () => {
    expect(VendorCreateSchema.safeParse({ name: 'Acme Co.' }).success).toBe(true);
  });

  it('VendorCreateSchema rejects a body missing name', () => {
    expect(VendorCreateSchema.safeParse({}).success).toBe(false);
    expect(VendorCreateSchema.safeParse({ name: '' }).success).toBe(false);
  });

  it('VendorCreateSchema is strict — rejects unknown keys', () => {
    expect(
      VendorCreateSchema.safeParse({ name: 'Acme Co.', surprise: true }).success,
    ).toBe(false);
  });

  it('VendorCreateSchema validates email when present', () => {
    expect(
      VendorCreateSchema.safeParse({ name: 'A', email: 'not-an-email' }).success,
    ).toBe(false);
    expect(
      VendorCreateSchema.safeParse({ name: 'A', email: 'ap@acme.example' }).success,
    ).toBe(true);
  });

  it('VendorPatchSchema accepts a partial body and an empty body', () => {
    expect(VendorPatchSchema.safeParse({}).success).toBe(true);
    expect(VendorPatchSchema.safeParse({ notes: 'updated' }).success).toBe(true);
    expect(VendorPatchSchema.safeParse({ is_active: false }).success).toBe(true);
  });

  it('VendorPatchSchema is strict — rejects unknown keys', () => {
    expect(VendorPatchSchema.safeParse({ name: 'A', surprise: 1 }).success).toBe(false);
  });

  it('VendorCreateSchema accepts the full optional surface', () => {
    const full = {
      name: 'Acme Supplies, Inc.',
      legal_name: 'Acme Supplies Incorporated',
      email: 'ap@acme.example',
      phone: '+1-555-0100',
      website: 'https://acme.example',
      tax_id: 'EIN-12-3456789',
      currency_code: 'USD',
      payment_terms_days: 30,
      billing_address: { line1: '1 Acme Way', city: 'Reno', region: 'NV' },
      external_ref: 'qb:V-001',
      notes: 'preferred packaging supplier',
    };
    expect(VendorCreateSchema.safeParse(full).success).toBe(true);
  });
});

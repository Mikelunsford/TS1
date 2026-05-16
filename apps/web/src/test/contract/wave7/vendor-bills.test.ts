import { describe, it, expect } from 'vitest';

import {
  VendorBillCreateSchema,
  VendorBillPatchSchema,
  VendorBillPaySchema,
  VendorBillSchema,
  VendorBillStateSchema,
} from '@/lib/types';

/**
 * Wire-contract tests for `/vendors-api/vendor-bills` (Wave 7 / Phase 10).
 *
 * Per Wave 7 conventions, vendor_bills are header-only (no
 * vendor_bill_line_items table in prod). `balance_cents` is set by the
 * `tg_vendor_bills_balance_biu` trigger from migration 0058
 * (balance := total - paid) — handlers MUST NOT write it directly.
 * `overdue` is a 7th status reachable from approved / partially_paid.
 *
 * The state-machine transitions live in `workflow-vendor-bill.test.ts`.
 */

const SAMPLE_BILL = {
  id: '00000000-0000-0000-0000-000000000701',
  org_id: '00000000-0000-0000-0000-0000000000aa',
  bill_number: 'VB-2026-0001',
  vendor_id: '00000000-0000-0000-0000-000000000401',
  po_id: '00000000-0000-0000-0000-000000000501',
  vendor_ref: 'V-INV-9001',
  status: 'draft' as const,
  issue_date: '2026-05-16',
  due_date: '2026-06-15',
  currency_code: 'USD',
  subtotal_cents: 10000,
  tax_cents: 875,
  total_cents: 10875,
  paid_cents: 0,
  balance_cents: 10875,
  notes: null,
  approved_at: null,
  approved_by: null,
  paid_at: null,
  created_at: '2026-05-16T12:00:00+00:00',
  updated_at: '2026-05-16T12:00:00+00:00',
  deleted_at: null,
};

describe('Wire contract: /vendors-api/vendor-bills', () => {
  it('VendorBillSchema accepts the canonical row shape', () => {
    const parsed = VendorBillSchema.safeParse(SAMPLE_BILL);
    expect(parsed.success, JSON.stringify(parsed)).toBe(true);
  });

  it('VendorBillSchema accepts balance_cents = null (pre-trigger row read)', () => {
    expect(
      VendorBillSchema.safeParse({ ...SAMPLE_BILL, balance_cents: null }).success,
    ).toBe(true);
  });

  it('VendorBillStateSchema enumerates the prod 7-state CHECK', () => {
    expect(VendorBillStateSchema.options.slice().sort()).toEqual(
      [
        'approved',
        'cancelled',
        'draft',
        'overdue',
        'paid',
        'partially_paid',
        'pending',
      ].sort(),
    );
    expect(VendorBillStateSchema.options.length).toBe(7);
  });

  it('VendorBillStateSchema rejects unknown states', () => {
    expect(VendorBillStateSchema.safeParse('refunded').success).toBe(false);
    expect(VendorBillStateSchema.safeParse('sent').success).toBe(false);
    expect(VendorBillStateSchema.safeParse('').success).toBe(false);
  });

  it('VendorBillCreateSchema accepts the minimum-required body', () => {
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: 10000,
        total_cents: 10000,
      }).success,
    ).toBe(true);
  });

  it('VendorBillCreateSchema rejects missing required fields', () => {
    // Missing vendor_id.
    expect(
      VendorBillCreateSchema.safeParse({
        due_date: '2026-06-15',
        subtotal_cents: 10000,
        total_cents: 10000,
      }).success,
    ).toBe(false);
    // Missing due_date.
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        subtotal_cents: 10000,
        total_cents: 10000,
      }).success,
    ).toBe(false);
    // Missing subtotal_cents.
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        total_cents: 10000,
      }).success,
    ).toBe(false);
    // Missing total_cents.
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: 10000,
      }).success,
    ).toBe(false);
  });

  it('VendorBillCreateSchema rejects negative cents fields', () => {
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: -1,
        total_cents: 100,
      }).success,
    ).toBe(false);
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: 100,
        total_cents: -1,
      }).success,
    ).toBe(false);
  });

  it('VendorBillCreateSchema currency_code is exactly 3 chars when present', () => {
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: 100,
        total_cents: 100,
        currency_code: 'USDX',
      }).success,
    ).toBe(false);
  });

  it('VendorBillCreateSchema is strict — rejects unknown keys', () => {
    expect(
      VendorBillCreateSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
        due_date: '2026-06-15',
        subtotal_cents: 100,
        total_cents: 100,
        surprise: true,
      }).success,
    ).toBe(false);
  });

  it('VendorBillPatchSchema accepts an empty body and partial updates', () => {
    expect(VendorBillPatchSchema.safeParse({}).success).toBe(true);
    expect(
      VendorBillPatchSchema.safeParse({ subtotal_cents: 200, total_cents: 200 }).success,
    ).toBe(true);
    expect(
      VendorBillPatchSchema.safeParse({ notes: 'updated', due_date: '2026-07-01' }).success,
    ).toBe(true);
  });

  it('VendorBillPatchSchema rejects vendor_id (immutable)', () => {
    expect(
      VendorBillPatchSchema.safeParse({
        vendor_id: '00000000-0000-0000-0000-000000000401',
      }).success,
    ).toBe(false);
  });

  it('VendorBillPaySchema accepts an empty body (defaults to full balance)', () => {
    expect(VendorBillPaySchema.safeParse({}).success).toBe(true);
  });

  it('VendorBillPaySchema accepts positive amount_cents', () => {
    expect(VendorBillPaySchema.safeParse({ amount_cents: 1 }).success).toBe(true);
    expect(VendorBillPaySchema.safeParse({ amount_cents: 5000 }).success).toBe(true);
  });

  it('VendorBillPaySchema rejects non-positive amount_cents', () => {
    expect(VendorBillPaySchema.safeParse({ amount_cents: 0 }).success).toBe(false);
    expect(VendorBillPaySchema.safeParse({ amount_cents: -1 }).success).toBe(false);
  });

  it('VendorBillPaySchema is strict — rejects unknown keys', () => {
    expect(
      VendorBillPaySchema.safeParse({ amount_cents: 100, surprise: 1 }).success,
    ).toBe(false);
  });
});

/**
 * exports-api — /exports/vendor_bills CSV stream.
 * Header-only (vendor bills are header rows in the current schema).
 * Gated on vendor_bills.read + procurement.enabled.
 */
import { makeExportHandler } from './_factory.ts';

interface VendorBillRow {
  id: string;
  org_id: string;
  bill_number: string;
  vendor_id: string;
  po_id: string | null;
  vendor_ref: string | null;
  status: string;
  issue_date: string | null;
  due_date: string | null;
  currency_code: string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  total_cents: number | string;
  paid_cents: number | string;
  balance_cents: number | string;
  notes: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export const exportVendorBills = makeExportHandler<VendorBillRow>({
  slug: 'vendor_bills',
  table: 'vendor_bills',
  cols:
    'id, org_id, bill_number, vendor_id, po_id, vendor_ref, status, issue_date, due_date, ' +
    'currency_code, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, ' +
    'notes, approved_at, paid_at, created_at, updated_at',
  headers: [
    'id',
    'bill_number',
    'vendor_id',
    'po_id',
    'vendor_ref',
    'status',
    'issue_date',
    'due_date',
    'currency_code',
    'subtotal_cents',
    'tax_cents',
    'total_cents',
    'paid_cents',
    'balance_cents',
    'notes',
    'approved_at',
    'paid_at',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.bill_number,
    r.vendor_id,
    r.po_id,
    r.vendor_ref,
    r.status,
    r.issue_date,
    r.due_date,
    r.currency_code,
    r.subtotal_cents,
    r.tax_cents,
    r.total_cents,
    r.paid_cents,
    r.balance_cents,
    r.notes,
    r.approved_at,
    r.paid_at,
    r.created_at,
    r.updated_at,
  ],
  cap: 'vendor_bills.read',
  flagKey: 'procurement.enabled',
  applyFilters: (qb, url) => {
    const status = url.searchParams.get('status');
    const vendorId = url.searchParams.get('vendor_id');
    if (status) qb = qb.eq('status', status);
    if (vendorId) qb = qb.eq('vendor_id', vendorId);
    return qb;
  },
});

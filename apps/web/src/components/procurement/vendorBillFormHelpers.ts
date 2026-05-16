/**
 * Pure form-state helpers extracted from VendorBillForm.tsx so the
 * component file only exports React components (react-refresh/only-export-components).
 */
import type { VendorBill } from '@/lib/types';

export interface VendorBillFormState {
  vendor_id: string;
  po_id: string;
  vendor_ref: string;
  issue_date: string;
  due_date: string;
  currency_code: string;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  notes: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function emptyVendorBillForm(): VendorBillFormState {
  return {
    vendor_id: '',
    po_id: '',
    vendor_ref: '',
    issue_date: todayIso(),
    due_date: '',
    currency_code: 'USD',
    subtotal_cents: 0,
    tax_cents: 0,
    total_cents: 0,
    notes: '',
  };
}

export function fromVendorBill(b: VendorBill): VendorBillFormState {
  return {
    vendor_id: b.vendor_id,
    po_id: b.po_id ?? '',
    vendor_ref: b.vendor_ref ?? '',
    issue_date: b.issue_date,
    due_date: b.due_date,
    currency_code: b.currency_code,
    subtotal_cents: Number(b.subtotal_cents),
    tax_cents: Number(b.tax_cents),
    total_cents: Number(b.total_cents),
    notes: b.notes ?? '',
  };
}

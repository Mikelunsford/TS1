/**
 * exports-api — /exports/vendors CSV stream.
 * Gated on vendors.read + procurement.enabled feature flag.
 */
import { makeExportHandler } from './_factory.ts';

interface VendorRow {
  id: string;
  org_id: string;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_id: string | null;
  currency_code: string | null;
  payment_terms_days: number | null;
  is_active: boolean;
  external_ref: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export const exportVendors = makeExportHandler<VendorRow>({
  slug: 'vendors',
  table: 'vendors',
  cols:
    'id, org_id, name, legal_name, email, phone, website, tax_id, currency_code, ' +
    'payment_terms_days, is_active, external_ref, notes, created_at, updated_at',
  headers: [
    'id',
    'name',
    'legal_name',
    'email',
    'phone',
    'website',
    'tax_id',
    'currency_code',
    'payment_terms_days',
    'is_active',
    'external_ref',
    'notes',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.name,
    r.legal_name,
    r.email,
    r.phone,
    r.website,
    r.tax_id,
    r.currency_code,
    r.payment_terms_days,
    r.is_active,
    r.external_ref,
    r.notes,
    r.created_at,
    r.updated_at,
  ],
  cap: 'vendors.read',
  flagKey: 'procurement.enabled',
});

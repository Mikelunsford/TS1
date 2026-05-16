/**
 * imports-api — /imports/vendors + /imports/vendors/commit.
 *
 * CSV columns recognized:
 *   name                   required
 *   legal_name             optional
 *   email                  optional
 *   phone                  optional
 *   website                optional
 *   tax_id                 optional
 *   currency_code          optional
 *   payment_terms_days     optional integer
 *   external_ref           optional
 *   notes                  optional
 *
 * Capability gate: vendors.write.
 */

import type { ImportRowError } from '../types.ts';
import { importHelpers, makeCommitHandler, makePreviewHandler, type EntityImportDef } from './_factory.ts';

interface VendorInsert {
  org_id: string;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  tax_id: string | null;
  currency_code: string | null;
  payment_terms_days: number | null;
  external_ref: string | null;
  notes: string | null;
  is_active: boolean;
}

const def: EntityImportDef<VendorInsert> = {
  slug: 'vendors',
  table: 'vendors',
  cap: 'vendors.write',
  mapRow: (raw, rowIndex, caller) => {
    const errors: ImportRowError[] = [];
    const nameRes = importHelpers.required(raw, 'name', rowIndex);
    let name = '';
    if (typeof nameRes === 'string') name = nameRes;
    else errors.push(nameRes);

    const terms = importHelpers.optionalInt(raw, 'payment_terms_days', rowIndex);
    if (typeof terms === 'object' && terms !== null) errors.push(terms);

    if (errors.length > 0) return errors;

    return {
      org_id: caller.orgId,
      name,
      legal_name: importHelpers.optional(raw, 'legal_name'),
      email: importHelpers.optional(raw, 'email'),
      phone: importHelpers.optional(raw, 'phone'),
      website: importHelpers.optional(raw, 'website'),
      tax_id: importHelpers.optional(raw, 'tax_id'),
      currency_code: importHelpers.optional(raw, 'currency_code'),
      payment_terms_days: typeof terms === 'number' ? terms : null,
      external_ref: importHelpers.optional(raw, 'external_ref'),
      notes: importHelpers.optional(raw, 'notes'),
      is_active: true,
    };
  },
};

export const previewVendors = makePreviewHandler(def);
export const commitVendors = makeCommitHandler(def);

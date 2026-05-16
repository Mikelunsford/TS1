/**
 * imports-api — /imports/customers + /imports/customers/commit.
 *
 * CSV columns recognized (case-sensitive header row):
 *   display_name           required
 *   kind                   optional, one of 'company' | 'individual' (default 'company')
 *   client_status          optional, default 'new'
 *   email                  optional
 *   phone                  optional
 *   tax_id                 optional
 *   currency_code          optional (e.g. 'USD')
 *   notes                  optional
 *
 * Maps `kind` -> `client_type` to match the DB schema (post F-Wave6-03).
 * Capability gate: crm.customers.write.
 */

import type { ImportRowError } from '../types.ts';
import { importHelpers, makeCommitHandler, makePreviewHandler, type EntityImportDef } from './_factory.ts';

interface CustomerInsert {
  org_id: string;
  display_name: string;
  client_type: string;
  client_status: string;
  email: string | null;
  phone: string | null;
  tax_id: string | null;
  currency_code: string | null;
  created_by: string;
  updated_by: string;
}

const def: EntityImportDef<CustomerInsert> = {
  slug: 'customers',
  table: 'customers',
  cap: 'crm.customers.write',
  mapRow: (raw, rowIndex, caller) => {
    const errors: ImportRowError[] = [];
    const nameRes = importHelpers.required(raw, 'display_name', rowIndex);
    let displayName = '';
    if (typeof nameRes === 'string') displayName = nameRes;
    else errors.push(nameRes);

    let kind = (raw.kind ?? 'company').trim().toLowerCase() || 'company';
    if (kind !== 'company' && kind !== 'individual') {
      errors.push({ row: rowIndex, field: 'kind', message: "kind must be 'company' or 'individual'" });
      kind = 'company';
    }

    const status = (raw.client_status ?? 'new').trim() || 'new';

    if (errors.length > 0) return errors;
    return {
      org_id: caller.orgId,
      display_name: displayName,
      client_type: kind,
      client_status: status,
      email: importHelpers.optional(raw, 'email'),
      phone: importHelpers.optional(raw, 'phone'),
      tax_id: importHelpers.optional(raw, 'tax_id'),
      currency_code: importHelpers.optional(raw, 'currency_code'),
      created_by: caller.userId,
      updated_by: caller.userId,
    };
  },
};

export const previewCustomers = makePreviewHandler(def);
export const commitCustomers = makeCommitHandler(def);

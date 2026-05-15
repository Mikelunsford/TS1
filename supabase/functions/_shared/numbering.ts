/**
 * Document numbering.
 *
 * Per TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §1.3 every human-facing
 * number (`quote_number`, `invoice_number`, etc.) is allocated by an
 * org-scoped SQL function `next_doc_number(org_id, kind)` reading from the
 * `numbering_sequences` table. Format strings live in
 * `org_settings.numbering.*`.
 *
 * Wave 0 stub. Wave 3+ wires the RPC call; until then no business code
 * needs a number, so this just throws to make accidental use loud.
 */

import type { SupabaseClient } from './supabase-admin.ts';

export type NumberingKind =
  | 'quote'
  | 'invoice'
  | 'project'
  | 'payment'
  | 'purchase_order'
  | 'credit_note'
  | 'expense'
  | 'receiving_order'
  | 'production_run'
  | 'shipment';

export async function nextNumber(
  _supabase: SupabaseClient,
  _orgId: string,
  _kind: NumberingKind,
): Promise<string> {
  // TODO Wave 3: const { data, error } = await supabase.rpc('next_doc_number', { p_org_id, p_kind });
  throw new Error('nextNumber: numbering ships in Wave 3');
}

export {};

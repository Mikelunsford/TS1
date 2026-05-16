/**
 * Document numbering — shared edge-function helper.
 *
 * Phase 14 (BUILD-ORDER §Phase 14) unifies all per-table number
 * allocation onto a single SECURITY DEFINER RPC `next_doc_number(p_org_id,
 * p_doc_type)` backed by `public.numbering_sequences`. Migration 0034
 * shipped the table + RPC; migration 0064 adds advisory locking,
 * `seed_org_numbering()`, write-policy lockdown, and high-water-mark
 * backfill from legacy `*_number` columns.
 *
 * The 12 canonical `DocKind`s:
 *   quote, invoice, credit_note, payment, project, purchase_order,
 *   vendor_bill, expense, journal_entry, receiving_order, production_run,
 *   shipment.
 *
 * Format: `prefix + YYYY + '-' + lpad(current_value, pad_width, '0')`
 * for `reset_period = 'yearly'` (every canonical kind ships yearly reset).
 *
 * Service-role only. Edge handlers MUST go through `getNextDocNumber()`
 * — direct `supabase.rpc('next_doc_number', ...)` calls are a Phase 14
 * lint signal (to be enforced post-release).
 */

import type { SupabaseClient } from './supabase-admin.ts';

export type DocKind =
  | 'quote'
  | 'invoice'
  | 'credit_note'
  | 'payment'
  | 'project'
  | 'purchase_order'
  | 'vendor_bill'
  | 'expense'
  | 'journal_entry'
  | 'receiving_order'
  | 'production_run'
  | 'shipment';

/**
 * Allocate the next document number for the given (org, kind).
 *
 * Throws `NumberingError` on RPC failure or non-string payload. Callers
 * should let it surface as a 500 — the RPC is supposed to be infallible
 * once the seed row exists.
 */
export async function getNextDocNumber(
  supabase: SupabaseClient,
  orgId: string,
  kind: DocKind,
): Promise<string> {
  const { data, error } = await supabase.rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: kind,
  });
  if (error) {
    throw new NumberingError(
      `next_doc_number(${kind}) RPC failed: ${error.message}`,
      kind,
      error,
    );
  }
  if (typeof data !== 'string' || data.length === 0) {
    throw new NumberingError(
      `next_doc_number(${kind}) returned non-string payload`,
      kind,
      null,
    );
  }
  return data;
}

export class NumberingError extends Error {
  readonly kind: DocKind;
  readonly cause: unknown;
  constructor(message: string, kind: DocKind, cause: unknown) {
    super(message);
    this.name = 'NumberingError';
    this.kind = kind;
    this.cause = cause;
  }
}

// Legacy export (Wave 0 stub). Kept exported so existing imports don't
// break during the rollout; new code should use getNextDocNumber.
export type NumberingKind = DocKind;
export const nextNumber = getNextDocNumber;

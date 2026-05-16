/**
 * Phase 14 — numbering canon (SPA side).
 *
 * Mirrors the 12 canonical `DocKind` set + the format string emitted by
 * the SECURITY DEFINER RPC `public.next_doc_number(p_org_id, p_doc_type)`
 * (migration 0034 + 0064). The SPA never *allocates* numbers — that's
 * always done by the edge function via the RPC — but knowing the format
 * shape lets us:
 *
 *   * Generate placeholder text in draft UI ("INV-…").
 *   * Validate display strings (`^INV-\d{4}-\d{5}$`).
 *   * Keep `_shared/numbering.ts` and SPA in lockstep via the contract
 *     test in `test/contract/phase14/numbering-unification.test.ts`.
 *
 * Source of truth: this file's `DOC_KINDS` MUST match the edge helper's
 * `DocKind` union exactly (parity-tested at type-check).
 */

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

export const DOC_KINDS: readonly DocKind[] = [
  'quote',
  'invoice',
  'credit_note',
  'payment',
  'project',
  'purchase_order',
  'vendor_bill',
  'expense',
  'journal_entry',
  'receiving_order',
  'production_run',
  'shipment',
] as const;

/**
 * Format a doc number exactly the way the RPC does for
 * `reset_period = 'yearly'`:
 *
 *   `${prefix}${year}-${lpad(value, pad, '0')}`
 *
 * The 12 canonical kinds all reset yearly per 0034 seed; non-yearly
 * formats are not used by any current SPA surface.
 */
export function formatNumber(
  prefix: string,
  year: number,
  value: number,
  pad: number,
): string {
  const padded = String(value).padStart(pad, '0');
  return `${prefix}${year}-${padded}`;
}

/**
 * Strict regex for a yearly-format doc number.
 *
 * Example: matchesDocNumber('INV-2026-00042', 'INV-') === true.
 */
export function matchesDocNumber(value: string, prefix: string, pad = 5): boolean {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped}\\d{4}-\\d{${pad}}$`);
  return re.test(value);
}

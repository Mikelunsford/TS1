/**
 * GET /search?q=<query>&types=customer,vendor,invoice&limit=20
 *
 * Federated search across the headline entities.
 *
 * ─── Wave 11B (Sub-agent B) — Closes R-W10-SEARCH-01 ─────────────────────────
 * Pre-Wave-11: every entity hit Postgres via a separate `.from(t).or(col.ilike.%q%)`
 *   round trip — Seq Scan once the table grew past a few hundred rows.
 *
 * Post-Wave-11: 10 of the entities (the headline set) are answered by a
 *   single SECURITY DEFINER RPC `federated_search`, which uses pg_trgm-backed
 *   ILIKE + similarity() ranking. Migration 0073 adds the GIN(trgm) indexes
 *   and the RPC.
 *
 * The remaining 4 entity types (payment / credit_note / purchase_order /
 *   journal_entry) keep the v1 ILIKE path because they were NOT in scope for
 *   R-W10-SEARCH-01. Future wave: extend `federated_search` to cover them.
 *
 * Each result row (same wire-envelope shape as v1):
 *   { type, id, display_name, snippet, url_path, org_id }
 *
 * Capability: `search.global`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap, type Caller } from '../../_shared/handler-helpers.ts';

interface SearchHit {
  type: string;
  id: string;
  display_name: string;
  snippet: string | null;
  url_path: string;
  org_id: string;
}

const RPC_ENTITY_TYPES = [
  'customer',
  'vendor',
  'lead',
  'opportunity',
  'quote',
  'project',
  'invoice',
  'item',
  'vendor_bill',
  'expense',
] as const;
type RpcEntityType = (typeof RPC_ENTITY_TYPES)[number];

const FALLBACK_ENTITY_TYPES = [
  'payment',
  'credit_note',
  'purchase_order',
  'journal_entry',
] as const;
type FallbackEntityType = (typeof FALLBACK_ENTITY_TYPES)[number];

const ENTITY_TYPES = [...RPC_ENTITY_TYPES, ...FALLBACK_ENTITY_TYPES] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

function escapeLike(q: string): string {
  // Postgres ILIKE wildcards: % and _. Escape user input so it's literal.
  return q.replace(/[\\%_]/g, (m) => '\\' + m);
}

export async function globalSearch({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'search.global');

    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) {
      return ok({ items: [], q }, undefined, { req });
    }
    const rawLimit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 20;

    const typesParam = url.searchParams.get('types');
    const types: EntityType[] = typesParam
      ? typesParam
          .split(',')
          .map((s) => s.trim())
          .filter((t): t is EntityType =>
            (ENTITY_TYPES as readonly string[]).includes(t),
          )
      : [...ENTITY_TYPES];

    const perType = Math.max(3, Math.ceil(limit / Math.max(types.length, 1)));
    const safeQ = escapeLike(q);
    const ilike = `%${safeQ}%`;

    const results: SearchHit[] = [];

    // ── Path 1: federated_search RPC (single round trip; ranked by similarity()).
    const rpcTypes = types.filter((t): t is RpcEntityType =>
      (RPC_ENTITY_TYPES as readonly string[]).includes(t),
    );
    if (rpcTypes.length > 0) {
      const rpcHits = await searchViaRpc(caller, q, rpcTypes, perType);
      for (const h of rpcHits) {
        results.push(h);
        if (results.length >= limit) break;
      }
    }

    // ── Path 2: legacy ILIKE for the 4 entities not yet in the RPC.
    if (results.length < limit) {
      const fallbackTypes = types.filter((t): t is FallbackEntityType =>
        (FALLBACK_ENTITY_TYPES as readonly string[]).includes(t),
      );
      for (const type of fallbackTypes) {
        const hits = await searchOne(caller, type, ilike, perType);
        for (const h of hits) {
          results.push(h);
          if (results.length >= limit) break;
        }
        if (results.length >= limit) break;
      }
    }

    return ok({ items: results.slice(0, limit), q, types }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

/**
 * Wave 11B: federated_search RPC (migration 0073). One round trip, ranked
 * by similarity() DESC inside Postgres. SECURITY DEFINER on the RPC re-applies
 * `org_id = p_org_id` per entity — defense in depth.
 */
async function searchViaRpc(
  caller: Caller,
  q: string,
  types: readonly RpcEntityType[],
  perType: number,
): Promise<SearchHit[]> {
  const db = admin();
  const { data, error } = await db.rpc('federated_search', {
    p_org_id: caller.orgId,
    p_q: q,
    p_types: [...types],
    p_per_type: perType,
  });
  if (error) {
    // Best-effort: log + fall through to empty so the partial result still ships.
    console.error('[search-api] federated_search RPC failed', error.message);
    return [];
  }
  const rows = (data ?? []) as Array<{
    type: string;
    id: string;
    display_name: string | null;
    snippet: string | null;
    url_path: string;
    org_id: string;
    score: number | null;
  }>;
  return rows.map((r) => ({
    type: r.type,
    id: r.id,
    display_name: r.display_name ?? '(unnamed)',
    snippet: r.snippet ?? null,
    url_path: r.url_path,
    org_id: r.org_id,
  }));
}

/** Legacy single-entity ILIKE fallback for entity types not covered by the RPC. */
async function searchOne(
  caller: Caller,
  type: FallbackEntityType,
  ilike: string,
  perType: number,
): Promise<SearchHit[]> {
  const db = admin();
  const orgId = caller.orgId;

  switch (type) {
    case 'payment': {
      const { data } = await db
        .from('payments')
        .select('id, org_id, payment_number, reference_number')
        .eq('org_id', orgId)
        .or(
          `payment_number.ilike.${ilike},reference_number.ilike.${ilike}`,
        )
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'payment',
        id: r.id as string,
        display_name: (r.payment_number as string) ?? '(unnamed)',
        snippet: (r.reference_number as string) ?? null,
        url_path: `/invoicing/payments/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'credit_note': {
      const { data } = await db
        .from('credit_notes')
        .select('id, org_id, credit_note_number, status')
        .eq('org_id', orgId)
        .ilike('credit_note_number', ilike)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'credit_note',
        id: r.id as string,
        display_name: (r.credit_note_number as string) ?? '(unnamed)',
        snippet: (r.status as string) ?? null,
        url_path: `/invoicing/credit-notes/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'purchase_order': {
      const { data } = await db
        .from('purchase_orders')
        .select('id, org_id, po_number, status')
        .eq('org_id', orgId)
        .ilike('po_number', ilike)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'purchase_order',
        id: r.id as string,
        display_name: (r.po_number as string) ?? '(unnamed)',
        snippet: (r.status as string) ?? null,
        url_path: `/vendors/purchase-orders/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'journal_entry': {
      const { data } = await db
        .from('journal_entries')
        .select('id, org_id, entry_number, description, status')
        .eq('org_id', orgId)
        .or(`entry_number.ilike.${ilike},description.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'journal_entry',
        id: r.id as string,
        display_name: (r.entry_number as string) ?? '(unnamed)',
        snippet: `${r.description ?? ''} · ${r.status ?? ''}`.trim(),
        url_path: `/finance/journal-entries/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    default:
      return [];
  }
}

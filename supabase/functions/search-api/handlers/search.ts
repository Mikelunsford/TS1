/**
 * GET /search?q=<query>&types=customer,vendor,invoice&limit=20
 *
 * Federated search across the headline entities. v1 uses ILIKE; future
 * upgrade path is pg_trgm + GIN or tsvector. Per-type cap of 5 keeps the
 * response bounded; global cap is `limit` (default 20, max 50).
 *
 * Each result row:
 *   { type, id, display_name, snippet, url_path, org_id }
 *
 * Capability: `search.global`.
 *
 * NOTE: this handler is intentionally simple — each entity hits its own
 * SELECT with `.eq('org_id', caller.orgId)` (Pattern A defense-in-depth).
 * For >10 entities we'd consolidate into a single UNION view in a future
 * migration; v1 is straight-line for legibility.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
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

const ENTITY_TYPES = [
  'customer',
  'vendor',
  'lead',
  'opportunity',
  'quote',
  'project',
  'invoice',
  'payment',
  'credit_note',
  'expense',
  'vendor_bill',
  'purchase_order',
  'item',
  'journal_entry',
] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

function escapeLike(q: string): string {
  // Postgres ILIKE wildcards: % and _. We escape user input so it's literal.
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

    for (const type of types) {
      const hits = await searchOne(caller, type, ilike, perType);
      for (const h of hits) results.push(h);
      if (results.length >= limit) break;
    }

    return ok({ items: results.slice(0, limit), q, types }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function searchOne(
  caller: Caller,
  type: EntityType,
  ilike: string,
  perType: number,
): Promise<SearchHit[]> {
  const db = admin();
  const orgId = caller.orgId;

  switch (type) {
    case 'customer': {
      const { data } = await db
        .from('customers')
        .select('id, org_id, display_name, email, phone')
        .eq('org_id', orgId)
        .or(`display_name.ilike.${ilike},email.ilike.${ilike},phone.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'customer',
        id: r.id as string,
        display_name: (r.display_name as string) ?? '(unnamed)',
        snippet: (r.email as string) ?? (r.phone as string) ?? null,
        url_path: `/crm/customers/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'vendor': {
      const { data } = await db
        .from('vendors')
        .select('id, org_id, name, email')
        .eq('org_id', orgId)
        .or(`name.ilike.${ilike},email.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'vendor',
        id: r.id as string,
        display_name: (r.name as string) ?? '(unnamed)',
        snippet: (r.email as string) ?? null,
        url_path: `/vendors/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'lead': {
      const { data } = await db
        .from('leads')
        .select('id, org_id, display_name, company_name, email')
        .eq('org_id', orgId)
        .or(
          `display_name.ilike.${ilike},company_name.ilike.${ilike},email.ilike.${ilike}`,
        )
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'lead',
        id: r.id as string,
        display_name: (r.display_name as string) ?? '(unnamed)',
        snippet: (r.company_name as string) ?? (r.email as string) ?? null,
        url_path: `/crm/leads/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'opportunity': {
      const { data } = await db
        .from('opportunities')
        .select('id, org_id, name, stage')
        .eq('org_id', orgId)
        .ilike('name', ilike)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'opportunity',
        id: r.id as string,
        display_name: (r.name as string) ?? '(unnamed)',
        snippet: (r.stage as string) ?? null,
        url_path: `/crm/opportunities/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'quote': {
      const { data } = await db
        .from('quotes')
        .select('id, org_id, quote_number, customer_name, status')
        .eq('org_id', orgId)
        .or(`quote_number.ilike.${ilike},customer_name.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'quote',
        id: r.id as string,
        display_name: (r.quote_number as string) ?? '(unnamed)',
        snippet: `${r.customer_name ?? ''} · ${r.status ?? ''}`.trim(),
        url_path: `/quotes/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'project': {
      const { data } = await db
        .from('projects')
        .select('id, org_id, project_number, customer_name, state')
        .eq('org_id', orgId)
        .or(`project_number.ilike.${ilike},customer_name.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'project',
        id: r.id as string,
        display_name: (r.project_number as string) ?? '(unnamed)',
        snippet: `${r.customer_name ?? ''} · ${r.state ?? ''}`.trim(),
        url_path: `/projects/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'invoice': {
      const { data } = await db
        .from('invoices')
        .select('id, org_id, invoice_number, customer_name_snapshot, status')
        .eq('org_id', orgId)
        .or(
          `invoice_number.ilike.${ilike},customer_name_snapshot.ilike.${ilike}`,
        )
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'invoice',
        id: r.id as string,
        display_name: (r.invoice_number as string) ?? '(unnamed)',
        snippet: `${r.customer_name_snapshot ?? ''} · ${r.status ?? ''}`.trim(),
        url_path: `/invoicing/invoices/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
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
    case 'expense': {
      const { data } = await db
        .from('expenses')
        .select('id, org_id, expense_number, description, status')
        .eq('org_id', orgId)
        .or(`expense_number.ilike.${ilike},description.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'expense',
        id: r.id as string,
        display_name: (r.expense_number as string) ?? '(unnamed)',
        snippet: `${r.description ?? ''} · ${r.status ?? ''}`.trim(),
        url_path: `/finance/expenses/${r.id}`,
        org_id: r.org_id as string,
      }));
    }
    case 'vendor_bill': {
      const { data } = await db
        .from('vendor_bills')
        .select('id, org_id, bill_number, vendor_invoice_number, status')
        .eq('org_id', orgId)
        .or(
          `bill_number.ilike.${ilike},vendor_invoice_number.ilike.${ilike}`,
        )
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'vendor_bill',
        id: r.id as string,
        display_name: (r.bill_number as string) ?? '(unnamed)',
        snippet: (r.vendor_invoice_number as string) ?? (r.status as string) ?? null,
        url_path: `/vendors/bills/${r.id}`,
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
    case 'item': {
      const { data } = await db
        .from('items')
        .select('id, org_id, sku, name')
        .eq('org_id', orgId)
        .or(`sku.ilike.${ilike},name.ilike.${ilike}`)
        .limit(perType);
      return (data ?? []).map((r) => ({
        type: 'item',
        id: r.id as string,
        display_name: (r.name as string) ?? (r.sku as string) ?? '(unnamed)',
        snippet: (r.sku as string) ?? null,
        url_path: `/inventory/items/${r.id}`,
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

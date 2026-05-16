/**
 * crm-api — /leads handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §3.3 + Wave-2 dispatch:
 *   GET    /leads                    — list (filters: status, owner, source)
 *   POST   /leads                    — create
 *   GET    /leads/:id                — detail
 *   PATCH  /leads/:id                — update
 *   POST   /leads/:id/convert        — TRANSACTIONAL: optional create customer,
 *                                       create opportunity, stamp converted_*,
 *                                       status -> 'converted'. Uses the
 *                                       DEFERRABLE fk_leads_opportunity from
 *                                       migration 0047.
 *
 * RLS pattern A. `display_name` on wire maps to DB column `display_name`
 * (leads has it natively).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  LeadConvertSchema,
  LeadCreateSchema,
  LeadPatchSchema,
  LeadSchema,
  type Lead,
} from '../../_shared/types.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../_helpers.ts';
import { writeAudit } from '../../_shared/audit.ts';

const LEAD_COLS =
  'id, org_id, lead_number, display_name, company_name, email, phone, source, status, ' +
  'assigned_to, estimated_value_cents, currency_code, expected_close_at, ' +
  'converted_customer_id, converted_opportunity_id, converted_at, notes, ' +
  'created_at, updated_at';

interface LeadRow {
  id: string;
  org_id: string;
  lead_number: string;
  display_name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  assigned_to: string | null;
  estimated_value_cents: number;
  currency_code: string | null;
  expected_close_at: string | null;
  converted_customer_id: string | null;
  converted_opportunity_id: string | null;
  converted_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToLead(row: LeadRow): Lead {
  return LeadSchema.parse({
    id: row.id,
    org_id: row.org_id,
    lead_number: row.lead_number,
    display_name: row.display_name,
    company_name: row.company_name,
    source: row.source,
    status: row.status,
    primary_email: row.email,
    primary_phone: row.phone,
    owner_user_id: row.assigned_to,
    estimated_value_cents: row.estimated_value_cents,
    currency_code: row.currency_code,
    expected_close_date: row.expected_close_at,
    converted_customer_id: row.converted_customer_id,
    converted_opportunity_id: row.converted_opportunity_id,
    converted_at: row.converted_at,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// =================================================================== GET /leads
export async function listLeads({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.leads.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const owner = url.searchParams.get('owner');
    const source = url.searchParams.get('source');

    let query = admin()
      .from('leads')
      .select(LEAD_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (owner) query = query.eq('assigned_to', owner);
    if (source) query = query.eq('source', source);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'lead list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as LeadRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToLead), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =============================================================== GET /leads/:id
export async function getLead({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.leads.read');
    const row = await fetchLeadRow(caller, params.id);
    return ok(rowToLead(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================================ POST /leads
export async function createLead({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.leads.write');
    const body = await parseBody(req, LeadCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /leads',
      body,
      async () => {
        const leadNumber = await nextLeadNumber(caller.orgId);
        const insertRow = {
          org_id: caller.orgId,
          lead_number: leadNumber,
          display_name: body.display_name,
          company_name: body.company_name ?? null,
          source: body.source,
          status: body.status,
          email: body.primary_email ?? null,
          phone: body.primary_phone ?? null,
          assigned_to: body.owner_user_id ?? null,
          estimated_value_cents: body.estimated_value_cents,
          currency_code: body.currency_code ?? null,
          expected_close_at: body.expected_close_date ?? null,
          notes: body.notes ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('leads')
          .insert(insertRow)
          .select(LEAD_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'lead insert failed', 500, {
            detail: error?.message,
          });
        }
        const lead = rowToLead(data as LeadRow);
        // Phase 17 step-8: audit_log write (Wave 10 Session 2 B2).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'lead',
          entity_id: lead.id,
          action: 'create',
          after: lead as unknown as Record<string, unknown>,
        });
        return { status: 201, body: { data: lead } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================== PATCH /leads/:id
export async function patchLead({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.leads.write');
    const body = await parseBody(req, LeadPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /leads/:id',
      body,
      async () => {
        await fetchLeadRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.display_name !== undefined) patch.display_name = body.display_name;
        if (body.company_name !== undefined) patch.company_name = body.company_name;
        if (body.source !== undefined) patch.source = body.source;
        if (body.status !== undefined) patch.status = body.status;
        if (body.primary_email !== undefined) patch.email = body.primary_email;
        if (body.primary_phone !== undefined) patch.phone = body.primary_phone;
        if (body.owner_user_id !== undefined) patch.assigned_to = body.owner_user_id;
        if (body.estimated_value_cents !== undefined)
          patch.estimated_value_cents = body.estimated_value_cents;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.expected_close_date !== undefined)
          patch.expected_close_at = body.expected_close_date;
        if (body.notes !== undefined) patch.notes = body.notes;

        const { data, error } = await admin()
          .from('leads')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(LEAD_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'lead update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToLead(data as LeadRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ======================================================= POST /leads/:id/convert
/**
 * Atomic convert flow via the convert_lead(...) SECURITY DEFINER RPC
 * (migration 0055 / F-Wave6-02). The RPC, inside a single transaction:
 *   1. (optional) creates a customer from lead fields,
 *   2. allocates opportunity_number via next_doc_number(org, 'opportunity'),
 *   3. inserts the opportunity in stage='prospect',
 *   4. stamps the lead with converted_customer_id, converted_opportunity_id,
 *      converted_at, status='converted'.
 *
 * Uses the DEFERRABLE fk_leads_opportunity FK from 0047 to allow the cyclic
 * reference. Replaces the prior best-effort-rollback pattern. Closes R-W2-04
 * / F-Wave4-04.
 */
export async function convertLead({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.leads.write');
    const body = await parseBody(req, LeadConvertSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /leads/:id/convert',
      body,
      async () => {
        const { data: rpcData, error: rpcErr } = await admin().rpc('convert_lead', {
          p_lead_id: id,
          p_opportunity_name: body.opportunity_name,
          p_opportunity_amount_cents: body.opportunity_amount_cents,
          p_opportunity_currency_code: body.opportunity_currency_code ?? null,
          p_customer_id: body.customer_id ?? null,
          p_create_customer: body.create_customer,
          p_actor_user_id: caller.userId,
        });

        if (rpcErr) {
          const msg = rpcErr.message ?? '';
          if (/already converted/i.test(msg)) {
            throw new ApiError('LEAD_ALREADY_CONVERTED', 'lead already converted', 409);
          }
          if (/lead .* not found/i.test(msg)) {
            throw new ApiError('NOT_FOUND', 'lead not found', 404);
          }
          if (/customer_id required/i.test(msg)) {
            throw new ApiError(
              'VALIDATION_ERROR',
              'customer_id required when create_customer is false',
              422,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'convert_lead RPC failed', 500, {
            detail: msg,
          });
        }

        const result = rpcData as {
          lead_id: string;
          customer_id: string;
          opportunity_id: string;
          opportunity_number: string;
        } | null;
        if (!result) {
          throw new ApiError('INTERNAL_ERROR', 'convert_lead RPC returned no data', 500);
        }

        // Re-fetch lead for response shape parity with prior handler.
        const updated = await fetchLeadRow(caller, id);

        return {
          status: 200,
          body: {
            data: {
              lead: rowToLead(updated),
              customer_id: result.customer_id,
              opportunity_id: result.opportunity_id,
            },
          },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchLeadRow(caller: Caller, id: string): Promise<LeadRow> {
  const { data, error } = await admin()
    .from('leads')
    .select(LEAD_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'lead lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'lead not found', 404);
  return data as LeadRow;
}

async function nextLeadNumber(orgId: string): Promise<string> {
  const { data, error } = await admin().rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: 'lead',
  });
  if (error || typeof data !== 'string') {
    throw new ApiError('INTERNAL_ERROR', 'next_doc_number lead failed', 500, {
      detail: error?.message,
    });
  }
  return data;
}

// nextOpportunityNumber removed by Wave 6 / F-Wave6-02 — the convert_lead
// SECURITY DEFINER RPC (migration 0055) now allocates opportunity numbers
// internally via public.next_doc_number(org, 'opportunity').

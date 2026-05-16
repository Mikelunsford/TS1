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
        return { status: 201, body: { data: rowToLead(data as LeadRow) } };
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
 * Transactional convert flow. Order:
 *   1. (optional) create customer from lead fields,
 *   2. create opportunity (lead_id set),
 *   3. patch lead with converted_customer_id, converted_opportunity_id,
 *      converted_at, status='converted'.
 *
 * The opportunities.lead_id FK is NOT deferrable (always insert opportunity
 * AFTER lead exists), but the lead.converted_opportunity_id FK IS DEFERRABLE
 * INITIALLY DEFERRED (migration 0047), allowing the update to reference an
 * opportunity row that exists by commit time.
 *
 * Because the Supabase JS client doesn't expose a transaction primitive, we
 * sequence inserts with explicit org_id scoping and accept best-effort
 * rollback by deleting the partially-created rows on failure. A future
 * iteration may wrap this in a SQL RPC for true ACID semantics; the
 * idempotency cache provides retry safety in the meantime.
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
        const lead = await fetchLeadRow(caller, id);
        if (lead.status === 'converted') {
          throw new ApiError('LEAD_ALREADY_CONVERTED', 'lead already converted', 409);
        }

        let customerId = body.customer_id ?? null;
        let createdCustomerId: string | null = null;

        if (body.create_customer) {
          const { data: c, error: cErr } = await admin()
            .from('customers')
            .insert({
              org_id: caller.orgId,
              display_name: lead.company_name ?? lead.display_name,
              client_type: 'company',
              client_status: 'active',
              email: lead.email,
              phone: lead.phone,
              currency_code: lead.currency_code,
              created_by: caller.userId,
              updated_by: caller.userId,
            })
            .select('id')
            .single();
          if (cErr || !c) {
            throw new ApiError('INTERNAL_ERROR', 'customer create failed during convert', 500, {
              detail: cErr?.message,
            });
          }
          customerId = c.id as string;
          createdCustomerId = c.id as string;
        }
        if (!customerId) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'customer_id required when create_customer is false',
            422,
          );
        }

        // 2. Create opportunity.
        const oppNumber = await nextOpportunityNumber(caller.orgId);
        const { data: opp, error: oErr } = await admin()
          .from('opportunities')
          .insert({
            org_id: caller.orgId,
            opportunity_number: oppNumber,
            customer_id: customerId,
            lead_id: id,
            name: body.opportunity_name,
            stage: 'prospect',
            amount_cents: body.opportunity_amount_cents,
            currency_code: body.opportunity_currency_code ?? lead.currency_code,
            owner_user_id: lead.assigned_to,
            created_by: caller.userId,
            updated_by: caller.userId,
          })
          .select('id')
          .single();
        if (oErr || !opp) {
          // Best-effort rollback of the customer we just created.
          if (createdCustomerId) {
            await admin().from('customers').delete().eq('id', createdCustomerId);
          }
          throw new ApiError('INTERNAL_ERROR', 'opportunity insert failed', 500, {
            detail: oErr?.message,
          });
        }

        // 3. Patch the lead. DEFERRABLE FK lets us write converted_opportunity_id.
        const { data: updated, error: uErr } = await admin()
          .from('leads')
          .update({
            converted_customer_id: customerId,
            converted_opportunity_id: opp.id,
            converted_at: new Date().toISOString(),
            status: 'converted',
            updated_by: caller.userId,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(LEAD_COLS)
          .single();
        if (uErr || !updated) {
          if (createdCustomerId) {
            await admin().from('customers').delete().eq('id', createdCustomerId);
          }
          await admin().from('opportunities').delete().eq('id', opp.id);
          throw new ApiError('INTERNAL_ERROR', 'lead update after convert failed', 500, {
            detail: uErr?.message,
          });
        }

        return {
          status: 200,
          body: {
            data: {
              lead: rowToLead(updated as LeadRow),
              customer_id: customerId,
              opportunity_id: opp.id,
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

async function nextOpportunityNumber(orgId: string): Promise<string> {
  const { data, error } = await admin().rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: 'opportunity',
  });
  if (error || typeof data !== 'string') {
    throw new ApiError('INTERNAL_ERROR', 'next_doc_number opportunity failed', 500, {
      detail: error?.message,
    });
  }
  return data;
}

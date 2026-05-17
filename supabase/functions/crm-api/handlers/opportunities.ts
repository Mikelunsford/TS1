/**
 * crm-api — /opportunities handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §3.4 + Wave-2 dispatch:
 *   GET    /opportunities                — list (filters: stage, customer, owner)
 *   POST   /opportunities                — create
 *   GET    /opportunities/:id            — detail
 *   PATCH  /opportunities/:id            — update (incl. stage)
 *   PUT    /opportunities/:id/stage      — dedicated stage transition; audit
 *                                          trigger fn_opportunities_audit_stage
 *                                          (migration 0047) writes audit_log
 *                                          automatically.
 *
 * Wire `display_name` maps to DB column `name`.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  OpportunityCreateSchema,
  OpportunityPatchSchema,
  OpportunitySchema,
  OpportunityStageUpdateSchema,
  type Opportunity,
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

// ─── Wave 11B audit sweep — Sub-agent B owns this block (R-W10-AUDIT-01). ───
// Skip state-change paths — DB triggers handle those (0041/0047/0058/0060).
// For opportunities: stage transitions write audit_log via fn_opportunities_audit_stage
// (migration 0047). The PUT /stage handler is intentionally NOT instrumented here.

const OPP_COLS =
  'id, org_id, opportunity_number, customer_id, lead_id, name, stage, ' +
  'amount_cents, currency_code, probability_pct, expected_close_at, closed_at, ' +
  'close_reason, owner_user_id, notes, created_at, updated_at';

interface OpportunityRow {
  id: string;
  org_id: string;
  opportunity_number: string;
  customer_id: string;
  lead_id: string | null;
  name: string;
  stage: string;
  amount_cents: number;
  currency_code: string | null;
  probability_pct: number;
  expected_close_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  owner_user_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToOpportunity(row: OpportunityRow): Opportunity {
  return OpportunitySchema.parse({
    id: row.id,
    org_id: row.org_id,
    opportunity_number: row.opportunity_number,
    customer_id: row.customer_id,
    lead_id: row.lead_id,
    display_name: row.name,
    stage: row.stage,
    amount_cents: row.amount_cents,
    currency_code: row.currency_code,
    probability_pct: Number(row.probability_pct),
    expected_close_date: row.expected_close_at,
    closed_at: row.closed_at,
    close_reason: row.close_reason,
    owner_user_id: row.owner_user_id,
    notes: row.notes,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
}

// =========================================================== GET /opportunities
export async function listOpportunities({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.opportunities.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const stage = url.searchParams.get('stage');
    const customerId = url.searchParams.get('customer_id');
    const owner = url.searchParams.get('owner');

    let query = admin()
      .from('opportunities')
      .select(OPP_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (stage) query = query.eq('stage', stage);
    if (customerId) query = query.eq('customer_id', customerId);
    if (owner) query = query.eq('owner_user_id', owner);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }
    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'opportunity list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const rows = (data ?? []) as OpportunityRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToOpportunity), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================= GET /opportunities/:id
export async function getOpportunity({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.opportunities.read');
    const row = await fetchOpportunityRow(caller, params.id);
    return ok(rowToOpportunity(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ========================================================== POST /opportunities
export async function createOpportunity({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.opportunities.write');
    const body = await parseBody(req, OpportunityCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /opportunities',
      body,
      async () => {
        // Ensure customer is visible to caller's org.
        const { data: customer } = await admin()
          .from('customers')
          .select('id')
          .eq('id', body.customer_id)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (!customer) {
          throw new ApiError('VALIDATION_ERROR', 'customer_id not found in caller org', 422);
        }

        const oppNumber = await nextOpportunityNumber(caller.orgId);
        const { data, error } = await admin()
          .from('opportunities')
          .insert({
            org_id: caller.orgId,
            opportunity_number: oppNumber,
            customer_id: body.customer_id,
            lead_id: body.lead_id ?? null,
            name: body.display_name,
            stage: body.stage,
            amount_cents: body.amount_cents,
            currency_code: body.currency_code,
            probability_pct: body.probability_pct,
            expected_close_at: body.expected_close_date ?? null,
            owner_user_id: body.owner_user_id ?? null,
            notes: body.notes ?? null,
            created_by: caller.userId,
            updated_by: caller.userId,
          })
          .select(OPP_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'opportunity insert failed', 500, {
            detail: error?.message,
          });
        }
        const opp = rowToOpportunity(data as OpportunityRow);
        // Phase 17 step-8: audit_log write (Wave 11B sweep).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'opportunity',
          entity_id: opp.id,
          action: 'create',
          after: opp as unknown as Record<string, unknown>,
        });
        return { status: 201, body: { data: opp } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ====================================================== PATCH /opportunities/:id
export async function patchOpportunity({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.opportunities.write');
    const body = await parseBody(req, OpportunityPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /opportunities/:id',
      body,
      async () => {
        const beforeRow = await fetchOpportunityRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.display_name !== undefined) patch.name = body.display_name;
        if (body.stage !== undefined) patch.stage = body.stage;
        if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.probability_pct !== undefined) patch.probability_pct = body.probability_pct;
        if (body.expected_close_date !== undefined)
          patch.expected_close_at = body.expected_close_date;
        if (body.owner_user_id !== undefined) patch.owner_user_id = body.owner_user_id;
        if (body.notes !== undefined) patch.notes = body.notes;

        const { data, error } = await admin()
          .from('opportunities')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(OPP_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'opportunity update failed', 500, {
            detail: error?.message,
          });
        }
        const after = rowToOpportunity(data as OpportunityRow);
        // Phase 17 step-8: audit_log write (Wave 11B sweep).
        // Stage transitions on this PATCH path are ALSO audited by the DB trigger
        // fn_opportunities_audit_stage (mig 0047); the application-level row here
        // covers non-stage field edits (name, amount, probability, owner, etc.).
        await writeAudit({
          actor_user_id: caller.userId,
          org_id: caller.orgId,
          entity_type: 'opportunity',
          entity_id: id,
          action: 'update',
          before: rowToOpportunity(beforeRow) as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
        });
        return { status: 200, body: { data: after } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================== PUT /opportunities/:id/stage
export async function updateOpportunityStage({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'crm.opportunities.write');
    const body = await parseBody(req, OpportunityStageUpdateSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PUT /opportunities/:id/stage',
      body,
      async () => {
        await fetchOpportunityRow(caller, id);
        const patch: Record<string, unknown> = {
          stage: body.stage,
          updated_by: caller.userId,
        };
        if (body.close_reason !== undefined) patch.close_reason = body.close_reason;
        if (body.stage === 'won' || body.stage === 'lost' || body.stage === 'abandoned') {
          patch.closed_at = new Date().toISOString();
        }
        const { data, error } = await admin()
          .from('opportunities')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(OPP_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'opportunity stage update failed', 500, {
            detail: error?.message,
          });
        }
        // audit_log row written by trg_opportunities_audit_stage (mig 0047).
        return { status: 200, body: { data: rowToOpportunity(data as OpportunityRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchOpportunityRow(caller: Caller, id: string): Promise<OpportunityRow> {
  const { data, error } = await admin()
    .from('opportunities')
    .select(OPP_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'opportunity lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'opportunity not found', 404);
  return data as OpportunityRow;
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

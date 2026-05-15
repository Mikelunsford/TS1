/**
 * finance-api — /taxes handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §7:
 *   GET    /taxes                 — list (filters: is_active, is_default)
 *   GET    /taxes/:id             — detail
 *   POST   /taxes                 — create (rate is 0..1 decimal, NOT bp)
 *   PATCH  /taxes/:id             — update
 *   POST   /taxes/:id/archive     — sets is_active=false
 *
 * The DB column `rate` is `numeric(7,6)` (e.g. 0.0875 = 8.75%). The API
 * contract §7 originally proposed `rate_bp`; we expose `rate` on the wire
 * to match the DB. Documented in the Zod schema and in the dispatch brief.
 *
 * `is_default` shuffle: when setting a row to `is_default=true`, first
 * un-default the prior default in the same org. Supabase JS has no
 * transaction primitive, so we do two sequential UPDATEs and attempt
 * best-effort rollback if the second fails (see crm-api LeadConvert R-W2-04).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { TaxCreateSchema, TaxPatchSchema, TaxSchema, type Tax } from '../../_shared/types.ts';
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

const TAX_COLS =
  'id, org_id, code, label, rate, jurisdiction, is_compound, is_inclusive, ' +
  'is_default, is_active, created_at, updated_at';

interface TaxRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  rate: string | number;
  jurisdiction: string | null;
  is_compound: boolean;
  is_inclusive: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToTax(row: TaxRow): Tax {
  return TaxSchema.parse(row);
}

// ================================================================== GET /taxes
export async function listTaxes({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const isActive = url.searchParams.get('is_active');
    const isDefault = url.searchParams.get('is_default');

    let query = admin()
      .from('taxes')
      .select(TAX_COLS)
      .eq('org_id', caller.orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);
    if (isDefault === 'true') query = query.eq('is_default', true);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'tax list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as TaxRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToTax), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================== GET /taxes/:id
export async function getTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.read');
    const row = await fetchTaxRow(caller, params.id);
    return ok(rowToTax(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================================= POST /taxes
export async function createTax({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const body = await parseBody(req, TaxCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /taxes',
      body,
      async () => {
        // If this row will be the new default, un-default the prior first.
        let priorDefaultId: string | null = null;
        if (body.is_default) {
          priorDefaultId = await unsetPriorDefault(caller, null);
        }

        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          rate: body.rate,
          jurisdiction: body.jurisdiction ?? null,
          is_compound: body.is_compound,
          is_inclusive: body.is_inclusive,
          is_default: body.is_default,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('taxes')
          .insert(insertRow)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          // Best-effort rollback of the un-default step.
          if (priorDefaultId) await restoreDefault(caller, priorDefaultId);
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'tax code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'tax insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToTax(data as TaxRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ PATCH /taxes/:id
export async function patchTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const body = await parseBody(req, TaxPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /taxes/:id',
      body,
      async () => {
        await fetchTaxRow(caller, id);

        let priorDefaultId: string | null = null;
        if (body.is_default === true) {
          priorDefaultId = await unsetPriorDefault(caller, id);
        }

        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.rate !== undefined) patch.rate = body.rate;
        if (body.jurisdiction !== undefined) patch.jurisdiction = body.jurisdiction;
        if (body.is_compound !== undefined) patch.is_compound = body.is_compound;
        if (body.is_inclusive !== undefined) patch.is_inclusive = body.is_inclusive;
        if (body.is_default !== undefined) patch.is_default = body.is_default;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('taxes')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          if (priorDefaultId) await restoreDefault(caller, priorDefaultId);
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'tax code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'tax update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToTax(data as TaxRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =================================================== POST /taxes/:id/archive
export async function archiveTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /taxes/:id/archive',
      { id },
      async () => {
        await fetchTaxRow(caller, id);
        const { data, error } = await admin()
          .from('taxes')
          .update({ is_active: false, is_default: false, updated_by: caller.userId })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'tax archive failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToTax(data as TaxRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// Internal helpers
// =========================================================================

async function fetchTaxRow(caller: Caller, id: string): Promise<TaxRow> {
  const { data, error } = await admin()
    .from('taxes')
    .select(TAX_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'tax lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'tax not found', 404);
  return data as TaxRow;
}

/**
 * Clear the current default tax for the caller's org (except `excludeId`
 * if provided). Returns the id of the row that was un-defaulted so the
 * caller can roll back on subsequent failure.
 */
async function unsetPriorDefault(caller: Caller, excludeId: string | null): Promise<string | null> {
  let query = admin()
    .from('taxes')
    .select('id')
    .eq('org_id', caller.orgId)
    .eq('is_default', true);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'default tax lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) return null;
  const priorId = (data as { id: string }).id;
  const { error: updErr } = await admin()
    .from('taxes')
    .update({ is_default: false, updated_by: caller.userId })
    .eq('id', priorId)
    .eq('org_id', caller.orgId);
  if (updErr) {
    throw new ApiError('INTERNAL_ERROR', 'failed to clear prior default tax', 500, {
      detail: updErr.message,
    });
  }
  return priorId;
}

async function restoreDefault(caller: Caller, id: string): Promise<void> {
  // Best-effort: ignore errors here — the caller is already throwing.
  await admin()
    .from('taxes')
    .update({ is_default: true, updated_by: caller.userId })
    .eq('id', id)
    .eq('org_id', caller.orgId);
}

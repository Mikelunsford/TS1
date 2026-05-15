/**
 * inventory-api — /units handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §9:
 *   GET    /units                — list
 *   POST   /units                — create
 *   PATCH  /units/:id            — update
 *   DELETE /units/:id            — delete (409 if items reference it)
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  UnitCreateSchema,
  UnitPatchSchema,
  UnitSchema,
  type Unit,
} from '../../_shared/types.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../_helpers.ts';

const UNIT_COLS = 'id, org_id, code, label, family, is_active, created_at, updated_at';

interface UnitRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  family: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToUnit(row: UnitRow): Unit {
  return UnitSchema.parse(row);
}

// ================================================================== GET /units
export async function listUnits({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.units.read');

    const { data, error } = await admin()
      .from('units')
      .select(UNIT_COLS)
      .eq('org_id', caller.orgId)
      .order('code', { ascending: true });
    if (error) {
      return err('INTERNAL_ERROR', 'unit list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const items = ((data ?? []) as UnitRow[]).map(rowToUnit);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================================= POST /units
export async function createUnit({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.units.write');
    const body = await parseBody(req, UnitCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /units',
      body,
      async () => {
        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          family: body.family ?? null,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('units')
          .insert(insertRow)
          .select(UNIT_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'unit code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'unit insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToUnit(data as UnitRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ PATCH /units/:id
export async function patchUnit({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.units.write');
    const body = await parseBody(req, UnitPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /units/:id',
      body,
      async () => {
        await fetchUnitRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.family !== undefined) patch.family = body.family;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('units')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(UNIT_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'unit code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'unit update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToUnit(data as UnitRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================== DELETE /units/:id
export async function deleteUnit({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.units.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /units/:id',
      { id },
      async () => {
        await fetchUnitRow(caller, id);

        const { count, error: refErr } = await admin()
          .from('items')
          .select('id', { head: true, count: 'exact' })
          .eq('org_id', caller.orgId)
          .eq('unit_id', id)
          .is('deleted_at', null);
        if (refErr) {
          throw new ApiError('INTERNAL_ERROR', 'item reference check failed', 500, {
            detail: refErr.message,
          });
        }
        if ((count ?? 0) > 0) {
          throw new ApiError('STATE_CONFLICT', 'cannot delete unit referenced by items', 409, {
            items_referencing: count,
          });
        }

        const { error } = await admin()
          .from('units')
          .delete()
          .eq('id', id)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'unit delete failed', 500, {
            detail: error.message,
          });
        }
        return { status: 200, body: { data: { ok: true } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchUnitRow(caller: Caller, id: string): Promise<UnitRow> {
  const { data, error } = await admin()
    .from('units')
    .select(UNIT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'unit lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'unit not found', 404);
  return data as UnitRow;
}

/**
 * inventory-api — /warehouses handlers (Wave 8d / Phase 13).
 *
 * Routes:
 *   GET    /warehouses              — list (filters: is_active, q)
 *   POST   /warehouses              — create
 *   GET    /warehouses/:id          — detail
 *   PATCH  /warehouses/:id          — update
 *   POST   /warehouses/:id/archive  — soft-archive (is_active=false)
 *
 * is_default semantics: at most one default per org. If a create or patch
 * sets is_default=true, the handler first unsets any prior default in the
 * same org (admin client transaction — service-role bypasses RLS). UNIQUE
 * (org_id, code) — 23505 → 409 STATE_CONFLICT.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  WarehouseCreateSchema,
  WarehousePatchSchema,
  WarehouseSchema,
  type Warehouse,
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
// warehouses has no state machine — all routes are non-state CRUD.

const WH_COLS =
  'id, org_id, code, label, address, is_default, is_active, created_at, updated_at';

interface WarehouseRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  address: Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToWarehouse(row: WarehouseRow): Warehouse {
  return WarehouseSchema.parse(row);
}

// =============================================================== GET /warehouses
export async function listWarehouses({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.warehouses.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const isActive = url.searchParams.get('is_active');
  const q = url.searchParams.get('q');

  let qb = admin()
    .from('warehouses')
    .select(WH_COLS)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (isActive === 'true') qb = qb.eq('is_active', true);
  else if (isActive === 'false') qb = qb.eq('is_active', false);
  if (q) qb = qb.or(`code.ilike.%${q}%,label.ilike.%${q}%`);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'warehouse list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as WarehouseRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok({ items: items.map(rowToWarehouse), next_cursor }, undefined, { req });
}

// ============================================================= POST /warehouses
export async function createWarehouse({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.warehouses.write');
  const body = await parseBody(req, WarehouseCreateSchema);

  return respondWithIdempotency(req, caller, 'POST /warehouses', body, async () => {
    if (body.is_default === true) {
      await unsetCurrentDefault(caller);
    }
    const insertRow = {
      org_id: caller.orgId,
      code: body.code,
      label: body.label,
      address: body.address ?? {},
      is_default: body.is_default ?? false,
      is_active: body.is_active ?? true,
      created_by: caller.userId,
      updated_by: caller.userId,
    };
    const { data, error } = await admin()
      .from('warehouses')
      .insert(insertRow)
      .select(WH_COLS)
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ApiError('STATE_CONFLICT', 'warehouse code already exists in this org', 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'warehouse insert failed', 500, { detail: error?.message });
    }
    const wh = rowToWarehouse(data as WarehouseRow);
    // Phase 17 step-8: audit_log write (Wave 11B sweep).
    await writeAudit({
      actor_user_id: caller.userId,
      org_id: caller.orgId,
      entity_type: 'warehouse',
      entity_id: wh.id,
      action: 'create',
      after: wh as unknown as Record<string, unknown>,
    });
    return { status: 201, body: { data: wh } };
  });
}

// =========================================================== GET /warehouses/:id
export async function getWarehouse({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.warehouses.read');
  const row = await fetchWarehouseRow(caller, params.id);
  return ok(rowToWarehouse(row), undefined, { req });
}

// ========================================================= PATCH /warehouses/:id
export async function patchWarehouse({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.warehouses.write');
  const body = await parseBody(req, WarehousePatchSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, 'PATCH /warehouses/:id', body, async () => {
    await fetchWarehouseRow(caller, id);
    if (body.is_default === true) {
      // Unset any other default in this org first.
      await unsetCurrentDefault(caller, id);
    }
    const patch: Record<string, unknown> = { updated_by: caller.userId };
    if (body.code !== undefined) patch.code = body.code;
    if (body.label !== undefined) patch.label = body.label;
    if (body.address !== undefined) patch.address = body.address;
    if (body.is_default !== undefined) patch.is_default = body.is_default;
    if (body.is_active !== undefined) patch.is_active = body.is_active;

    const { data, error } = await admin()
      .from('warehouses')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(WH_COLS)
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ApiError('STATE_CONFLICT', 'warehouse code already exists in this org', 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'warehouse update failed', 500, { detail: error?.message });
    }
    const wh = rowToWarehouse(data as WarehouseRow);
    // Phase 17 step-8: audit_log write (Wave 11B sweep).
    await writeAudit({
      actor_user_id: caller.userId,
      org_id: caller.orgId,
      entity_type: 'warehouse',
      entity_id: id,
      action: 'update',
      after: wh as unknown as Record<string, unknown>,
    });
    return { status: 200, body: { data: wh } };
  });
}

// =============================================== POST /warehouses/:id/archive
export async function archiveWarehouse({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.warehouses.write');
  const id = params.id;

  return respondWithIdempotency(req, caller, 'POST /warehouses/:id/archive', { id }, async () => {
    const existing = await fetchWarehouseRow(caller, id);
    if (existing.is_default) {
      throw new ApiError('STATE_CONFLICT', 'cannot archive the default warehouse', 409);
    }
    const { data, error } = await admin()
      .from('warehouses')
      .update({ is_active: false, updated_by: caller.userId })
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(WH_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'warehouse archive failed', 500, { detail: error?.message });
    }
    // Phase 17 step-8: audit_log write (Wave 11B sweep).
    await writeAudit({
      actor_user_id: caller.userId,
      org_id: caller.orgId,
      entity_type: 'warehouse',
      entity_id: id,
      action: 'archive',
      after: { is_active: false },
    });
    return { status: 200, body: { data: rowToWarehouse(data as WarehouseRow) } };
  });
}

// ---- helpers ----

async function unsetCurrentDefault(caller: Caller, excludeId?: string): Promise<void> {
  let qb = admin()
    .from('warehouses')
    .update({ is_default: false, updated_by: caller.userId })
    .eq('org_id', caller.orgId)
    .eq('is_default', true);
  if (excludeId) qb = qb.neq('id', excludeId);
  const { error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to unset prior default warehouse', 500, {
      detail: error.message,
    });
  }
}

async function fetchWarehouseRow(caller: Caller, id: string): Promise<WarehouseRow> {
  const { data, error } = await admin()
    .from('warehouses')
    .select(WH_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'warehouse lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'warehouse not found', 404);
  return data as WarehouseRow;
}

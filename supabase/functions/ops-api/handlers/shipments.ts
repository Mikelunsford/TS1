/**
 * ops-api — /shipments handlers (Wave 8d / Phase 13).
 *
 * Routes:
 *   GET    /shipments                       — list (cursor; filters: status,
 *                                                project_id)
 *   POST   /shipments                       — create (status='scheduled');
 *                                                shipment_number := next_doc_number
 *                                                (org, 'shipment')
 *   GET    /shipments/:id                   — detail
 *   PATCH  /shipments/:id                   — patch (scheduled-only)
 *   POST   /shipments/:id/start-loading     — scheduled → loading; stamps
 *                                                loading_started_at
 *   POST   /shipments/:id/ship              — loading → shipped; stamps shipped_at
 *   POST   /shipments/:id/cancel            — scheduled|loading → cancelled;
 *                                                body { cancellation_reason? }
 *
 * State machine: SHIPMENT_TRANSITIONS. The DB has a partial unique index
 * `uniq_active_shipment_per_project` (only one non-terminal shipment per
 * project). carrier_name NOT NULL btrim>0 enforced by table CHECK.
 *
 * Stock movement auto-emit on ship is DEFERRED per R-W8D-INTEGRATION-01.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ShipmentCancelSchema,
  ShipmentCreateSchema,
  ShipmentPatchSchema,
  ShipmentSchema,
  type ProjectMini,
  type Shipment,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';
import {
  admin,
  decodeCursor,
  fetchProjectMiniMap,
  paginate,
  parseBody,
  parseExpand,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';
import { getNextDocNumber, NumberingError } from '../../_shared/numbering.ts';

const BUNDLE = 'ops-api';
const SH_COLS =
  'id, org_id, shipment_number, project_id, status, qty_shipped, carrier_name, ' +
  'tracking_number, scheduled_pickup_at, loading_started_at, shipped_at, ' +
  'cancelled_at, cancellation_reason, notes, created_at, updated_at';

interface ShRow {
  id: string;
  org_id: string;
  shipment_number: string;
  project_id: string;
  status: 'scheduled' | 'loading' | 'shipped' | 'cancelled';
  qty_shipped: string | number;
  carrier_name: string;
  tracking_number: string | null;
  scheduled_pickup_at: string | null;
  loading_started_at: string | null;
  shipped_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

function rowToSh(row: ShRow, project?: ProjectMini | null): Shipment {
  return ShipmentSchema.parse({ ...row, project: project ?? undefined });
}

// ================================================================ GET /shipments
export async function listShipments({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');

  let qb = admin()
    .from('shipments')
    .select(SH_COLS)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) qb = qb.eq('status', status);
  if (projectId) qb = qb.eq('project_id', projectId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'shipments list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as ShRow[];
  const { items, next_cursor } = paginate(rows, limit);

  // R-W8F-OBS-03 — embed project mini when ?expand=project.
  const expand = parseExpand(url);
  const projectMap = expand.has('project')
    ? await fetchProjectMiniMap(caller, [...new Set(items.map((r) => r.project_id))])
    : null;

  return ok(
    {
      items: items.map((r) => rowToSh(r, projectMap?.get(r.project_id) ?? null)),
      next_cursor,
    },
    undefined,
    { req },
  );
}

// =============================================================== POST /shipments
export async function createShipment({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.write');
  const body = await parseBody(req, ShipmentCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /shipments', body, async () => {
    const { data: project, error: projErr } = await admin()
      .from('projects')
      .select('id')
      .eq('id', body.project_id)
      .eq('org_id', caller.orgId)
      .maybeSingle();
    if (projErr) {
      throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, { detail: projErr.message });
    }
    if (!project) throw new ApiError('NOT_FOUND', 'project not found in org', 404);

    let shipmentNumber: string;
    try {
      shipmentNumber = await getNextDocNumber(admin(), caller.orgId, 'shipment');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number shipment failed', 500, {
          detail: e.message,
        });
      }
      throw e;
    }

    const insertRow = {
      org_id: caller.orgId,
      shipment_number: shipmentNumber,
      project_id: body.project_id,
      status: 'scheduled' as const,
      qty_shipped: body.qty_shipped,
      carrier_name: body.carrier_name,
      tracking_number: body.tracking_number ?? null,
      scheduled_pickup_at: body.scheduled_pickup_at ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await admin()
      .from('shipments')
      .insert(insertRow)
      .select(SH_COLS)
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ApiError('STATE_CONFLICT', 'a non-terminal shipment already exists for this project', 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'shipment insert failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 201, body: { data: rowToSh(data as ShRow) } };
  });
}

// =========================================================== GET /shipments/:id
export async function getShipment({ req, url, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.read');
  const row = await fetchShRow(caller, params.id);

  // R-W8F-OBS-03 — embed project mini when ?expand=project.
  const expand = parseExpand(url);
  const project = expand.has('project')
    ? (await fetchProjectMiniMap(caller, [row.project_id])).get(row.project_id) ?? null
    : undefined;

  return ok(rowToSh(row, project), undefined, { req });
}

// ========================================================= PATCH /shipments/:id
export async function patchShipment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.write');
  const body = await parseBody(req, ShipmentPatchSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /shipments/${id}`, body, async () => {
    const existing = await fetchShRow(caller, id);
    if (existing.status !== 'scheduled') {
      throw new ApiError('STATE_CONFLICT', `cannot edit shipment in status=${existing.status}`, 409);
    }
    const patch: Record<string, unknown> = {};
    for (const k of ['qty_shipped', 'carrier_name', 'tracking_number', 'scheduled_pickup_at', 'notes'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('shipments')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(SH_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'shipment update failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToSh(data as ShRow) } };
  });
}

// --------- workflow transitions ----------

export async function startLoadingShipment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.write');
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `POST /shipments/${id}/start-loading`, {}, async () => {
    const existing = await fetchShRow(caller, id);
    try {
      assertTransition('shipment', existing.status, 'loading');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const { data, error } = await admin()
      .from('shipments')
      .update({
        status: 'loading',
        loading_started_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(SH_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'shipment start-loading failed', 500, { detail: error?.message });
    }
    return { status: 200, body: { data: rowToSh(data as ShRow) } };
  });
}

export async function shipShipment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.write');
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `POST /shipments/${id}/ship`, {}, async () => {
    const existing = await fetchShRow(caller, id);
    try {
      assertTransition('shipment', existing.status, 'shipped');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const { data, error } = await admin()
      .from('shipments')
      .update({
        status: 'shipped',
        shipped_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(SH_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'shipment ship failed', 500, { detail: error?.message });
    }
    return { status: 200, body: { data: rowToSh(data as ShRow) } };
  });
}

export async function cancelShipment({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'shipping.write');
  const body = await parseBody(req, ShipmentCancelSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `POST /shipments/${id}/cancel`, body, async () => {
    const existing = await fetchShRow(caller, id);
    try {
      assertTransition('shipment', existing.status, 'cancelled');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const { data, error } = await admin()
      .from('shipments')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancellation_reason: body.cancellation_reason ?? null,
      })
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(SH_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'shipment cancel failed', 500, { detail: error?.message });
    }
    return { status: 200, body: { data: rowToSh(data as ShRow) } };
  });
}

// ---- helpers ----

async function fetchShRow(caller: Caller, id: string): Promise<ShRow> {
  const { data, error } = await admin()
    .from('shipments')
    .select(SH_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'shipment lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'shipment not found', 404);
  return data as ShRow;
}

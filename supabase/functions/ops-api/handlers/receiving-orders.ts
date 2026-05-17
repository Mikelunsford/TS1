/**
 * ops-api — /receiving-orders handlers (Wave 8d / Phase 13).
 *
 * Routes:
 *   GET    /receiving-orders                  — list (cursor; filters: status,
 *                                                 project_id, source, bom_item_id)
 *   POST   /receiving-orders                  — create (status='open');
 *                                                 ro_number := next_doc_number
 *                                                 (org, 'receiving_order')
 *   GET    /receiving-orders/:id              — detail
 *   PATCH  /receiving-orders/:id              — patch (open-only)
 *   POST   /receiving-orders/:id/receive      — body { received_qty }; transitions
 *                                                 open → partial (or → received
 *                                                 when received_qty >= expected_qty)
 *   POST   /receiving-orders/:id/cancel       — open|partial → cancelled
 *
 * State machine: RECEIVING_ORDER_TRANSITIONS (workflow.ts). The receive
 * endpoint takes the ABSOLUTE cumulative received_qty (not a delta) — this
 * mirrors how PO receive works in vendors-api.
 *
 * Stock movement auto-emit on receive is DEFERRED per R-W8D-INTEGRATION-01.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ReceivingOrderCreateSchema,
  ReceivingOrderPatchSchema,
  ReceivingOrderReceiveSchema,
  ReceivingOrderSchema,
  type ProjectMini,
  type ReceivingOrder,
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
const RO_COLS =
  'id, org_id, ro_number, project_id, bom_item_id, source, status, ' +
  'expected_qty, received_qty, pallets_in, vendor, expected_at, notes, ' +
  'received_at, cancelled_at, created_at, updated_at';

interface RoRow {
  id: string;
  org_id: string;
  ro_number: string;
  project_id: string;
  bom_item_id: string | null;
  source: 'customer_supplied' | 't1_purchase';
  status: 'open' | 'partial' | 'received' | 'cancelled';
  expected_qty: string | number;
  received_qty: string | number;
  pallets_in: number | null;
  vendor: string | null;
  expected_at: string | null;
  notes: string | null;
  received_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToRo(row: RoRow, project?: ProjectMini | null): ReceivingOrder {
  return ReceivingOrderSchema.parse({ ...row, project: project ?? undefined });
}

// ========================================================== GET /receiving-orders
export async function listReceivingOrders({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const projectId = url.searchParams.get('project_id');
  const source = url.searchParams.get('source');
  const bomItemId = url.searchParams.get('bom_item_id');

  let qb = admin()
    .from('receiving_orders')
    .select(RO_COLS)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) qb = qb.eq('status', status);
  if (projectId) qb = qb.eq('project_id', projectId);
  if (source) qb = qb.eq('source', source);
  if (bomItemId) qb = qb.eq('bom_item_id', bomItemId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'receiving_orders list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as RoRow[];
  const { items, next_cursor } = paginate(rows, limit);

  // R-W8F-OBS-03 — embed project mini when requested. Batch over the visible page only.
  const expand = parseExpand(url);
  const projectMap = expand.has('project')
    ? await fetchProjectMiniMap(caller, [...new Set(items.map((r) => r.project_id))])
    : null;

  return ok(
    {
      items: items.map((r) => rowToRo(r, projectMap?.get(r.project_id) ?? null)),
      next_cursor,
    },
    undefined,
    { req },
  );
}

// ========================================================= POST /receiving-orders
export async function createReceivingOrder({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.write');
  const body = await parseBody(req, ReceivingOrderCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /receiving-orders', body, async () => {
    // Verify project belongs to caller's org.
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

    let roNumber: string;
    try {
      roNumber = await getNextDocNumber(admin(), caller.orgId, 'receiving_order');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number receiving_order failed', 500, {
          detail: e.message,
        });
      }
      throw e;
    }

    const insertRow = {
      org_id: caller.orgId,
      ro_number: roNumber,
      project_id: body.project_id,
      bom_item_id: body.bom_item_id ?? null,
      source: body.source,
      status: 'open' as const,
      expected_qty: body.expected_qty,
      received_qty: 0,
      pallets_in: body.pallets_in ?? null,
      vendor: body.vendor ?? null,
      expected_at: body.expected_at ?? null,
      notes: body.notes ?? null,
    };
    const { data, error } = await admin()
      .from('receiving_orders')
      .insert(insertRow)
      .select(RO_COLS)
      .single();
    if (error || !data) {
      if (error?.code === '23505') {
        throw new ApiError('STATE_CONFLICT', 'ro_number collision', 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'receiving_order insert failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 201, body: { data: rowToRo(data as RoRow) } };
  });
}

// ===================================================== GET /receiving-orders/:id
export async function getReceivingOrder({ req, url, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.read');
  const row = await fetchRoRow(caller, params.id);

  // R-W8F-OBS-03 — embed project mini when ?expand=project.
  const expand = parseExpand(url);
  const project = expand.has('project')
    ? (await fetchProjectMiniMap(caller, [row.project_id])).get(row.project_id) ?? null
    : undefined;

  return ok(rowToRo(row, project), undefined, { req });
}

// =================================================== PATCH /receiving-orders/:id
export async function patchReceivingOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.write');
  const body = await parseBody(req, ReceivingOrderPatchSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /receiving-orders/${id}`, body, async () => {
    const existing = await fetchRoRow(caller, id);
    if (existing.status !== 'open') {
      throw new ApiError('STATE_CONFLICT', `cannot edit receiving_order in status=${existing.status}`, 409);
    }
    const patch: Record<string, unknown> = {};
    for (const k of ['bom_item_id', 'source', 'expected_qty', 'pallets_in', 'vendor', 'expected_at', 'notes'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('receiving_orders')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(RO_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'receiving_order update failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToRo(data as RoRow) } };
  });
}

// ============================================ POST /receiving-orders/:id/receive
export async function receiveReceivingOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.write');
  const body = await parseBody(req, ReceivingOrderReceiveSchema);
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `POST /receiving-orders/${id}/receive`, body, async () => {
    const existing = await fetchRoRow(caller, id);
    if (!['open', 'partial'].includes(existing.status)) {
      throw new ApiError('STATE_CONFLICT', `cannot receive in status=${existing.status}`, 409);
    }
    const expectedQty = Number(existing.expected_qty);
    const newReceivedQty = body.received_qty;
    if (newReceivedQty < Number(existing.received_qty)) {
      throw new ApiError('VALIDATION_ERROR', 'received_qty cannot decrease', 400);
    }

    const newStatus: 'partial' | 'received' = newReceivedQty >= expectedQty ? 'received' : 'partial';
    try {
      assertTransition('receiving_order', existing.status, newStatus);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> = {
      received_qty: newReceivedQty,
      status: newStatus,
    };
    if (newStatus === 'received') patch.received_at = nowIso;
    if (body.notes !== undefined && body.notes !== null) patch.notes = body.notes;

    const { data, error } = await admin()
      .from('receiving_orders')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(RO_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'receiving_order receive failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToRo(data as RoRow) } };
  });
}

// ============================================ POST /receiving-orders/:id/cancel
export async function cancelReceivingOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'receiving.write');
  const id = params.id;

  return respondWithIdempotency(req, caller, BUNDLE, `POST /receiving-orders/${id}/cancel`, {}, async () => {
    const existing = await fetchRoRow(caller, id);
    try {
      assertTransition('receiving_order', existing.status, 'cancelled');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const { data, error } = await admin()
      .from('receiving_orders')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(RO_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', 'receiving_order cancel failed', 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToRo(data as RoRow) } };
  });
}

// ---- helpers ----

async function fetchRoRow(caller: Caller, id: string): Promise<RoRow> {
  const { data, error } = await admin()
    .from('receiving_orders')
    .select(RO_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'receiving_order lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'receiving_order not found', 404);
  return data as RoRow;
}

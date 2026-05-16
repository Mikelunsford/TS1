/**
 * vendors-api — /purchase-orders + /purchase-orders/:id/lines handlers
 * (Wave 7 / Phase 10).
 *
 * POs flow through PURCHASE_ORDER_TRANSITIONS (7-state machine). Workflow
 * endpoints stamp `state_changed_at = now()` + the new status. Line totals
 * roll up via the tg_po_lines_recompute AIUD trigger added in 0058 — handler
 * INSERTs/UPDATEs/DELETEs against po_line_items and the trigger keeps
 * purchase_orders.subtotal_cents / total_cents in sync.
 *
 * Line-total math: line_total_cents = round_half_even(quantity * unit_cost_cents).
 * Computed handler-side using the canonical roundHalfEven helper to stay
 * constitutional (half-even rounding active per F-Wave5-02).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import { getNextDocNumber, NumberingError } from '../../_shared/numbering.ts';
import {
  POLineItemCreateSchema,
  POLineItemPatchSchema,
  PurchaseOrderCreateSchema,
  PurchaseOrderPatchSchema,
  PurchaseOrderReceiveSchema,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';
import { roundHalfEven } from '../../_shared/money.ts';

const BUNDLE = 'vendors-api';
const PO_COLS =
  'id, org_id, po_number, vendor_id, project_id, status, issue_date, expected_date, ' +
  'currency_code, subtotal_cents, tax_cents, shipping_cents, total_cents, notes, ' +
  'state_changed_at, created_at, updated_at, deleted_at';
const LINE_COLS =
  'id, org_id, po_id, item_id, description, quantity, quantity_received, unit, ' +
  'unit_cost_cents, line_total_cents, position, created_at, updated_at';

function computeLineTotal(quantity: number, unitCostCents: number): number {
  // unit_cost_cents is integer cents; quantity may be fractional. The product
  // may be fractional cents — half-even round to integer cents per the
  // constitutional money rule (F-Wave5-02).
  return roundHalfEven(quantity * unitCostCents);
}

export async function listPurchaseOrders({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.read');
  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const vendorId = url.searchParams.get('vendor_id');
  const projectId = url.searchParams.get('project_id');

  let qb = admin()
    .from('purchase_orders')
    .select(PO_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (status) qb = qb.eq('status', status);
  if (vendorId) qb = qb.eq('vendor_id', vendorId);
  if (projectId) qb = qb.eq('project_id', projectId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to list purchase orders', 500, { db: error.message });
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function createPurchaseOrder({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.write');
  const body = await parseBody(req, PurchaseOrderCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /purchase-orders', body, async () => {
    let poNumber: string;
    try {
      poNumber = await getNextDocNumber(admin(), caller.orgId, 'purchase_order');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number purchase_order failed', 500, { db: e.message });
      }
      throw e;
    }

    const { data: po, error: poErr } = await admin()
      .from('purchase_orders')
      .insert({
        org_id: caller.orgId,
        po_number: poNumber,
        vendor_id: body.vendor_id,
        project_id: body.project_id ?? null,
        status: 'draft',
        issue_date: body.issue_date ?? new Date().toISOString().slice(0, 10),
        expected_date: body.expected_date ?? null,
        currency_code: body.currency_code ?? 'USD',
        tax_cents: body.tax_cents ?? 0,
        shipping_cents: body.shipping_cents ?? 0,
        notes: body.notes ?? null,
        created_by: caller.userId,
        updated_by: caller.userId,
      })
      .select(PO_COLS)
      .single();
    if (poErr || !po) throw new ApiError('INTERNAL_ERROR', 'failed to create PO', 500, { db: poErr?.message });

    if (body.lines && body.lines.length > 0) {
      const lineRows = body.lines.map((line, idx) => ({
        org_id: caller.orgId,
        po_id: po.id,
        item_id: line.item_id ?? null,
        description: line.description,
        quantity: line.quantity,
        quantity_received: 0,
        unit: line.unit ?? null,
        unit_cost_cents: line.unit_cost_cents,
        line_total_cents: computeLineTotal(line.quantity, line.unit_cost_cents),
        position: line.position ?? idx,
      }));
      const { error: lineErr } = await admin().from('po_line_items').insert(lineRows);
      if (lineErr) throw new ApiError('INTERNAL_ERROR', 'failed to create PO lines', 500, { db: lineErr.message });
    }

    // Re-fetch so totals reflect the trigger recompute.
    const { data: poFinal } = await admin()
      .from('purchase_orders')
      .select(PO_COLS)
      .eq('id', po.id)
      .single();
    return { status: 201, body: { data: poFinal ?? po } };
  });
}

export async function getPurchaseOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.read');
  const { data, error } = await admin()
    .from('purchase_orders')
    .select(PO_COLS)
    .eq('org_id', caller.orgId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to load purchase order', 500, { db: error.message });
  if (!data) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);

  const { data: lines } = await admin()
    .from('po_line_items')
    .select(LINE_COLS)
    .eq('po_id', params.id)
    .order('position', { ascending: true });
  return ok({ ...data, lines: lines ?? [] }, undefined, { req });
}

export async function patchPurchaseOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.write');
  const body = await parseBody(req, PurchaseOrderPatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /purchase-orders/${params.id}`, body, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('purchase_orders')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load purchase order', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);
    if (existing.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', `cannot edit PO in status=${existing.status}`, 409);
    }

    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: new Date().toISOString() };
    for (const k of ['project_id', 'issue_date', 'expected_date', 'currency_code', 'tax_cents', 'shipping_cents', 'notes'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('purchase_orders')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(PO_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update PO', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

async function transitionPO(
  req: Request,
  poId: string,
  to: 'submitted' | 'approved' | 'cancelled' | 'closed' | 'partial_received' | 'received',
  cap: 'purchase_orders.write' | 'purchase_orders.approve' | 'purchase_orders.cancel' | 'purchase_orders.receive',
  route: string,
): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, cap);

  return respondWithIdempotency(req, caller, BUNDLE, route, {}, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('purchase_orders')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', poId)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);

    try {
      assertTransition('purchase_order', existing.status, to);
    } catch (e) {
      if (e instanceof WorkflowError) {
        throw new ApiError('STATE_CONFLICT', e.message, 409);
      }
      throw e;
    }

    const { data, error } = await admin()
      .from('purchase_orders')
      .update({
        status: to,
        state_changed_at: new Date().toISOString(),
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', caller.orgId)
      .eq('id', poId)
      .select(PO_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update PO status', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

export const submitPurchaseOrder = ({ req, params }: Ctx) =>
  transitionPO(req, params.id, 'submitted', 'purchase_orders.write', `POST /purchase-orders/${params.id}/submit`);
export const approvePurchaseOrder = ({ req, params }: Ctx) =>
  transitionPO(req, params.id, 'approved', 'purchase_orders.approve', `POST /purchase-orders/${params.id}/approve`);
export const cancelPurchaseOrder = ({ req, params }: Ctx) =>
  transitionPO(req, params.id, 'cancelled', 'purchase_orders.cancel', `POST /purchase-orders/${params.id}/cancel`);
export const closePurchaseOrder = ({ req, params }: Ctx) =>
  transitionPO(req, params.id, 'closed', 'purchase_orders.write', `POST /purchase-orders/${params.id}/close`);

/**
 * POST /purchase-orders/:id/receive — partial-receive endpoint.
 * Body: { lines: [{ po_line_item_id, quantity_received }, ...] }
 * Updates each line's `quantity_received`; transitions PO status to
 * `received` if all lines fully received, else `partial_received`.
 */
export async function receivePurchaseOrder({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.receive');
  const body = await parseBody(req, PurchaseOrderReceiveSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `POST /purchase-orders/${params.id}/receive`, body, async () => {
    const { data: po, error: poErr } = await admin()
      .from('purchase_orders')
      .select('id, status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (poErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO', 500, { db: poErr.message });
    if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);
    if (!['approved', 'partial_received'].includes(po.status)) {
      throw new ApiError('STATE_CONFLICT', `cannot receive PO in status=${po.status}`, 409);
    }

    for (const upd of body.lines) {
      const { error } = await admin()
        .from('po_line_items')
        .update({ quantity_received: upd.quantity_received, updated_at: new Date().toISOString() })
        .eq('po_id', params.id)
        .eq('id', upd.po_line_item_id);
      if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update PO line', 500, { db: error.message });
    }

    // Determine new status: all lines fully received → 'received'; else 'partial_received'.
    const { data: lines, error: lineErr } = await admin()
      .from('po_line_items')
      .select('quantity, quantity_received')
      .eq('po_id', params.id);
    if (lineErr) throw new ApiError('INTERNAL_ERROR', 'failed to read PO lines', 500, { db: lineErr.message });
    const allReceived = (lines ?? []).every((l) => Number(l.quantity_received) >= Number(l.quantity));
    const newStatus = allReceived ? 'received' : 'partial_received';

    try {
      assertTransition('purchase_order', po.status, newStatus);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const { data, error } = await admin()
      .from('purchase_orders')
      .update({
        status: newStatus,
        state_changed_at: new Date().toISOString(),
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(PO_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update PO status', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

// ---- Line item management ----

export async function addPOLineItem({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.write');
  const body = await parseBody(req, POLineItemCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `POST /purchase-orders/${params.id}/lines`, body, async () => {
    const { data: po, error: poErr } = await admin()
      .from('purchase_orders')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (poErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO', 500, { db: poErr.message });
    if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);
    if (po.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', `cannot edit lines in PO status=${po.status}`, 409);
    }

    const { data, error } = await admin()
      .from('po_line_items')
      .insert({
        org_id: caller.orgId,
        po_id: params.id,
        item_id: body.item_id ?? null,
        description: body.description,
        quantity: body.quantity,
        quantity_received: 0,
        unit: body.unit ?? null,
        unit_cost_cents: body.unit_cost_cents,
        line_total_cents: computeLineTotal(body.quantity, body.unit_cost_cents),
        position: body.position ?? 0,
      })
      .select(LINE_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to add PO line', 500, { db: error.message });
    return { status: 201, body: { data } };
  });
}

export async function patchPOLineItem({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.write');
  const body = await parseBody(req, POLineItemPatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /purchase-orders/${params.id}/lines/${params.lineId}`, body, async () => {
    const { data: po, error: poErr } = await admin()
      .from('purchase_orders')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (poErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO', 500, { db: poErr.message });
    if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);
    if (po.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', `cannot edit lines in PO status=${po.status}`, 409);
    }

    const { data: cur, error: curErr } = await admin()
      .from('po_line_items')
      .select('quantity, unit_cost_cents')
      .eq('po_id', params.id)
      .eq('id', params.lineId)
      .maybeSingle();
    if (curErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO line', 500, { db: curErr.message });
    if (!cur) throw new ApiError('NOT_FOUND', 'PO line not found', 404);

    const newQty = body.quantity ?? Number(cur.quantity);
    const newCost = body.unit_cost_cents ?? Number(cur.unit_cost_cents);
    const patch: Record<string, unknown> = {
      line_total_cents: computeLineTotal(newQty, newCost),
      updated_at: new Date().toISOString(),
    };
    for (const k of ['description', 'quantity', 'unit', 'unit_cost_cents', 'position'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('po_line_items')
      .update(patch)
      .eq('po_id', params.id)
      .eq('id', params.lineId)
      .select(LINE_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update PO line', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

export async function deletePOLineItem({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'purchase_orders.write');

  return respondWithIdempotency(req, caller, BUNDLE, `DELETE /purchase-orders/${params.id}/lines/${params.lineId}`, {}, async () => {
    const { data: po, error: poErr } = await admin()
      .from('purchase_orders')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (poErr) throw new ApiError('INTERNAL_ERROR', 'failed to load PO', 500, { db: poErr.message });
    if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);
    if (po.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', `cannot delete lines in PO status=${po.status}`, 409);
    }

    const { error } = await admin()
      .from('po_line_items')
      .delete()
      .eq('po_id', params.id)
      .eq('id', params.lineId);
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to delete PO line', 500, { db: error.message });
    return { status: 204, body: { data: null } };
  });
}

/**
 * vendors-api — /vendor-bills handlers (Wave 7 / Phase 10).
 *
 * AP-side of procurement. Vendor bills are header-only (no
 * vendor_bill_line_items table in prod, D-W7-6); handler accepts
 * subtotal/tax/total in body. `balance_cents` is set by the BIU
 * trigger from 0058 (= total_cents - paid_cents). Workflow flows through
 * VENDOR_BILL_TRANSITIONS (7-state).
 *
 * Pay endpoint stamps `paid_at` + bumps `paid_cents`; trigger keeps
 * balance_cents in sync. When paid_cents reaches total_cents, transition to
 * 'paid' (terminal). Partial payment → 'partially_paid'.
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
  VendorBillCreateSchema,
  VendorBillPatchSchema,
  VendorBillPaySchema,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';

const BUNDLE = 'vendors-api';
const VB_COLS =
  'id, org_id, bill_number, vendor_id, po_id, vendor_ref, status, issue_date, due_date, ' +
  'currency_code, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, notes, ' +
  'approved_at, approved_by, paid_at, created_at, updated_at, deleted_at';

export async function listVendorBills({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.read');
  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const vendorId = url.searchParams.get('vendor_id');
  const poId = url.searchParams.get('po_id');

  let qb = admin()
    .from('vendor_bills')
    .select(VB_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (status) qb = qb.eq('status', status);
  if (vendorId) qb = qb.eq('vendor_id', vendorId);
  if (poId) qb = qb.eq('po_id', poId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to list vendor bills', 500, { db: error.message });
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function createVendorBill({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.write');
  const body = await parseBody(req, VendorBillCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /vendor-bills', body, async () => {
    let billNumber: string;
    try {
      billNumber = await getNextDocNumber(admin(), caller.orgId, 'vendor_bill');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number vendor_bill failed', 500, { db: e.message });
      }
      throw e;
    }

    const { data, error } = await admin()
      .from('vendor_bills')
      .insert({
        org_id: caller.orgId,
        bill_number: billNumber,
        vendor_id: body.vendor_id,
        po_id: body.po_id ?? null,
        vendor_ref: body.vendor_ref ?? null,
        status: 'draft',
        issue_date: body.issue_date ?? new Date().toISOString().slice(0, 10),
        due_date: body.due_date,
        currency_code: body.currency_code ?? 'USD',
        subtotal_cents: body.subtotal_cents,
        tax_cents: body.tax_cents ?? 0,
        total_cents: body.total_cents,
        paid_cents: 0,
        notes: body.notes ?? null,
        created_by: caller.userId,
        updated_by: caller.userId,
      })
      .select(VB_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to create vendor bill', 500, { db: error.message });
    return { status: 201, body: { data } };
  });
}

export async function getVendorBill({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.read');
  const { data, error } = await admin()
    .from('vendor_bills')
    .select(VB_COLS)
    .eq('org_id', caller.orgId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, { db: error.message });
  if (!data) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);
  return ok(data, undefined, { req });
}

export async function patchVendorBill({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.write');
  const body = await parseBody(req, VendorBillPatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /vendor-bills/${params.id}`, body, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('vendor_bills')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);
    if (existing.status !== 'draft') {
      throw new ApiError('STATE_CONFLICT', `cannot edit vendor bill in status=${existing.status}`, 409);
    }

    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: new Date().toISOString() };
    for (const k of [
      'po_id', 'vendor_ref', 'issue_date', 'due_date', 'currency_code',
      'subtotal_cents', 'tax_cents', 'total_cents', 'notes',
    ] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('vendor_bills')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(VB_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update vendor bill', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

async function transitionVendorBill(
  req: Request,
  vbId: string,
  to: 'pending' | 'approved' | 'cancelled',
  cap: 'vendor_bills.write' | 'vendor_bills.approve',
  route: string,
  extraPatch: Record<string, unknown> = {},
): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, cap);

  return respondWithIdempotency(req, caller, BUNDLE, route, {}, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('vendor_bills')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', vbId)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);

    try {
      assertTransition('vendor_bill', existing.status, to);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const patch = {
      status: to,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
      ...extraPatch,
    };
    const { data, error } = await admin()
      .from('vendor_bills')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', vbId)
      .select(VB_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update vendor bill status', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

export const submitVendorBill = ({ req, params }: Ctx) =>
  transitionVendorBill(req, params.id, 'pending', 'vendor_bills.write', `POST /vendor-bills/${params.id}/submit`);
export const cancelVendorBill = ({ req, params }: Ctx) =>
  transitionVendorBill(req, params.id, 'cancelled', 'vendor_bills.write', `POST /vendor-bills/${params.id}/cancel`);

// Approve stamps `approved_at` + `approved_by = caller.userId` in addition
// to the status transition; we need caller's id closed over so we don't
// use the transitionVendorBill helper here.
export async function approveVendorBill({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.approve');

  return respondWithIdempotency(req, caller, BUNDLE, `POST /vendor-bills/${params.id}/approve`, {}, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('vendor_bills')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);

    try {
      assertTransition('vendor_bill', existing.status, 'approved');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const { data, error } = await admin()
      .from('vendor_bills')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: caller.userId,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(VB_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to approve vendor bill', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

/**
 * POST /vendor-bills/:id/pay
 *
 * Body: { amount_cents?: number }  — defaults to full remaining balance.
 *
 * Bumps `paid_cents` by amount; balance_cents auto-recomputed by BIU
 * trigger. Status transitions:
 *   - new paid_cents >= total_cents → 'paid' (stamps paid_at)
 *   - new paid_cents > 0 && < total_cents → 'partially_paid'
 */
export async function payVendorBill({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'vendor_bills.pay');
  const body = await parseBody(req, VendorBillPaySchema);

  return respondWithIdempotency(req, caller, BUNDLE, `POST /vendor-bills/${params.id}/pay`, body, async () => {
    const { data: vb, error: getErr } = await admin()
      .from('vendor_bills')
      .select('status, total_cents, paid_cents, balance_cents')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, { db: getErr.message });
    if (!vb) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);
    if (!['approved', 'partially_paid', 'overdue'].includes(vb.status)) {
      throw new ApiError('STATE_CONFLICT', `cannot pay vendor bill in status=${vb.status}`, 409);
    }

    const total = Number(vb.total_cents);
    const alreadyPaid = Number(vb.paid_cents);
    const remaining = total - alreadyPaid;
    if (remaining <= 0) {
      throw new ApiError('STATE_CONFLICT', 'vendor bill already fully paid', 409);
    }
    const amount = body.amount_cents ?? remaining;
    if (amount > remaining) {
      throw new ApiError('VALIDATION_ERROR', `amount_cents ${amount} exceeds remaining balance ${remaining}`, 422);
    }

    const newPaid = alreadyPaid + amount;
    const newStatus = newPaid >= total ? 'paid' : 'partially_paid';

    try {
      assertTransition('vendor_bill', vb.status, newStatus);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const patch: Record<string, unknown> = {
      paid_cents: newPaid,
      status: newStatus,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
    };
    if (newStatus === 'paid') patch.paid_at = new Date().toISOString();

    const { data, error } = await admin()
      .from('vendor_bills')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(VB_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to pay vendor bill', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

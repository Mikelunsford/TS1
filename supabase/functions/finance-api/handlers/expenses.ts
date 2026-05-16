/**
 * finance-api — /expenses handlers (Wave 7 / Phase 11).
 *
 * Single-line expense lifecycle: submitter creates draft → submit → accounting
 * approves / rejects → paid (vendor) or reimbursed (employee). total_cents
 * computed by the BIU trigger from 0058 (= amount_cents + tax_cents).
 *
 * Submitter is stamped to caller.userId on create. Rejected expenses can be
 * re-edited by the submitter (RLS expenses_update_self_draft covers
 * draft/submitted/rejected). Accounting capability gates approve/reject/pay.
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
  ExpenseCreateSchema,
  ExpensePatchSchema,
  ExpenseRejectSchema,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';

const BUNDLE = 'finance-api';
const EXP_COLS =
  'id, org_id, expense_number, category_id, vendor_id, project_id, account_id, ' +
  'spent_at, description, status, currency_code, amount_cents, tax_cents, tax_id, ' +
  'total_cents, paid_at, receipt_url, notes, submitted_by, approved_by, approved_at, ' +
  'created_at, updated_at, deleted_at';

export async function listExpenses({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.read');
  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');
  const categoryId = url.searchParams.get('category_id');
  const projectId = url.searchParams.get('project_id');
  const me = url.searchParams.get('me') === 'true';

  let qb = admin()
    .from('expenses')
    .select(EXP_COLS)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (status) qb = qb.eq('status', status);
  if (categoryId) qb = qb.eq('category_id', categoryId);
  if (projectId) qb = qb.eq('project_id', projectId);
  if (me) qb = qb.eq('submitted_by', caller.userId);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to list expenses', 500, { db: error.message });
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function createExpense({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.write');
  const body = await parseBody(req, ExpenseCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /expenses', body, async () => {
    let expenseNumber: string;
    try {
      expenseNumber = await getNextDocNumber(admin(), caller.orgId, 'expense');
    } catch (e) {
      if (e instanceof NumberingError) {
        throw new ApiError('INTERNAL_ERROR', 'next_doc_number expense failed', 500, { db: e.message });
      }
      throw e;
    }

    const { data, error } = await admin()
      .from('expenses')
      .insert({
        org_id: caller.orgId,
        expense_number: expenseNumber,
        category_id: body.category_id ?? null,
        vendor_id: body.vendor_id ?? null,
        project_id: body.project_id ?? null,
        account_id: body.account_id ?? null,
        spent_at: body.spent_at ?? new Date().toISOString().slice(0, 10),
        description: body.description ?? null,
        status: 'draft',
        currency_code: body.currency_code ?? 'USD',
        amount_cents: body.amount_cents,
        tax_cents: body.tax_cents ?? 0,
        tax_id: body.tax_id ?? null,
        receipt_url: body.receipt_url ?? null,
        notes: body.notes ?? null,
        submitted_by: caller.userId,
        created_by: caller.userId,
        updated_by: caller.userId,
      })
      .select(EXP_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to create expense', 500, { db: error.message });
    return { status: 201, body: { data } };
  });
}

export async function getExpense({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.read');
  const { data, error } = await admin()
    .from('expenses')
    .select(EXP_COLS)
    .eq('org_id', caller.orgId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to load expense', 500, { db: error.message });
  if (!data) throw new ApiError('NOT_FOUND', 'expense not found', 404);
  return ok(data, undefined, { req });
}

export async function patchExpense({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.write');
  const body = await parseBody(req, ExpensePatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /expenses/${params.id}`, body, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('expenses')
      .select('status, submitted_by')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load expense', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'expense not found', 404);
    if (!['draft', 'rejected'].includes(existing.status)) {
      throw new ApiError('STATE_CONFLICT', `cannot edit expense in status=${existing.status}`, 409);
    }

    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: new Date().toISOString() };
    for (const k of [
      'category_id', 'vendor_id', 'project_id', 'account_id', 'spent_at',
      'description', 'currency_code', 'amount_cents', 'tax_cents', 'tax_id',
      'receipt_url', 'notes',
    ] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('expenses')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(EXP_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update expense', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

async function transitionExpense(
  req: Request,
  expId: string,
  to: 'submitted' | 'approved' | 'reimbursed' | 'paid',
  cap: 'expenses.submit' | 'expenses.approve' | 'expenses.write',
  route: string,
  extraPatch: Record<string, unknown> = {},
): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, cap);

  return respondWithIdempotency(req, caller, BUNDLE, route, {}, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('expenses')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', expId)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load expense', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'expense not found', 404);

    try {
      assertTransition('expense', existing.status, to);
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const patch: Record<string, unknown> = {
      status: to,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
      ...extraPatch,
    };
    const { data, error } = await admin()
      .from('expenses')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', expId)
      .select(EXP_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update expense status', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

export const submitExpense = ({ req, params }: Ctx) =>
  transitionExpense(req, params.id, 'submitted', 'expenses.submit', `POST /expenses/${params.id}/submit`);
export const reimburseExpense = ({ req, params }: Ctx) =>
  transitionExpense(req, params.id, 'reimbursed', 'expenses.approve', `POST /expenses/${params.id}/reimburse`,
    { paid_at: new Date().toISOString() });
export const payExpense = ({ req, params }: Ctx) =>
  transitionExpense(req, params.id, 'paid', 'expenses.approve', `POST /expenses/${params.id}/pay`,
    { paid_at: new Date().toISOString() });

// Approve stamps approved_at + approved_by = caller.userId.
export async function approveExpense({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.approve');

  return respondWithIdempotency(req, caller, BUNDLE, `POST /expenses/${params.id}/approve`, {}, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('expenses')
      .select('status')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load expense', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'expense not found', 404);
    try {
      assertTransition('expense', existing.status, 'approved');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }
    const { data, error } = await admin()
      .from('expenses')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: caller.userId,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(EXP_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to approve expense', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

// Reject stores the reason in `notes` (no separate rejection_reason column);
// the prefixed marker disambiguates user-entered notes from rejection text.
export async function rejectExpense({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.approve');
  const body = await parseBody(req, ExpenseRejectSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `POST /expenses/${params.id}/reject`, body, async () => {
    const { data: existing, error: getErr } = await admin()
      .from('expenses')
      .select('status, notes')
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .is('deleted_at', null)
      .maybeSingle();
    if (getErr) throw new ApiError('INTERNAL_ERROR', 'failed to load expense', 500, { db: getErr.message });
    if (!existing) throw new ApiError('NOT_FOUND', 'expense not found', 404);
    try {
      assertTransition('expense', existing.status, 'rejected');
    } catch (e) {
      if (e instanceof WorkflowError) throw new ApiError('STATE_CONFLICT', e.message, 409);
      throw e;
    }

    const stampedNotes = `${existing.notes ?? ''}\n[REJECTED ${new Date().toISOString()} by ${caller.userId}]: ${body.reason}`.trim();
    const { data, error } = await admin()
      .from('expenses')
      .update({
        status: 'rejected',
        notes: stampedNotes,
        updated_by: caller.userId,
        updated_at: new Date().toISOString(),
      })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(EXP_COLS)
      .single();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to reject expense', 500, { db: error.message });
    return { status: 200, body: { data } };
  });
}

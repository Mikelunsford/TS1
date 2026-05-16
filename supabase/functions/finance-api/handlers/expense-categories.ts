/**
 * finance-api — /expense-categories handlers (Wave 7 / Phase 11).
 *
 * CRUD over public.expense_categories. UNIQUE (org_id, code) → 23505 → 409.
 * RLS: expense_categories_select (any staff if is_active) +
 * expense_categories_write_fin (owner/admin/accounting). Archive flips
 * is_active=false (no row deletion).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
} from '../../_shared/handler-helpers.ts';
import {
  ExpenseCategoryCreateSchema,
  ExpenseCategoryPatchSchema,
} from '../../_shared/types.ts';

const BUNDLE = 'finance-api';
const COLS =
  'id, org_id, code, label, default_account_id, is_active, created_at, updated_at';

export async function listExpenseCategories({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.read');
  const includeInactive = url.searchParams.get('include_inactive') === 'true';

  let qb = admin()
    .from('expense_categories')
    .select(COLS)
    .eq('org_id', caller.orgId)
    .order('code', { ascending: true });
  if (!includeInactive) qb = qb.eq('is_active', true);

  const { data, error } = await qb;
  if (error) throw new ApiError('INTERNAL_ERROR', 'failed to list expense categories', 500, { db: error.message });
  return ok({ items: data ?? [], next_cursor: null }, undefined, { req });
}

export async function createExpenseCategory({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.write');
  const body = await parseBody(req, ExpenseCategoryCreateSchema);

  return respondWithIdempotency(req, caller, BUNDLE, 'POST /expense-categories', body, async () => {
    const { data, error } = await admin()
      .from('expense_categories')
      .insert({
        org_id: caller.orgId,
        code: body.code,
        label: body.label,
        default_account_id: body.default_account_id ?? null,
        is_active: true,
        created_by: caller.userId,
        updated_by: caller.userId,
      })
      .select(COLS)
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ApiError('STATE_CONFLICT', `expense category code already exists`, 409);
      }
      throw new ApiError('INTERNAL_ERROR', 'failed to create expense category', 500, { db: error.message });
    }
    return { status: 201, body: { data } };
  });
}

export async function patchExpenseCategory({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.write');
  const body = await parseBody(req, ExpenseCategoryPatchSchema);

  return respondWithIdempotency(req, caller, BUNDLE, `PATCH /expense-categories/${params.id}`, body, async () => {
    const patch: Record<string, unknown> = { updated_by: caller.userId, updated_at: new Date().toISOString() };
    for (const k of ['label', 'default_account_id', 'is_active'] as const) {
      if (k in body) patch[k] = (body as Record<string, unknown>)[k];
    }
    const { data, error } = await admin()
      .from('expense_categories')
      .update(patch)
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(COLS)
      .maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to update expense category', 500, { db: error.message });
    if (!data) throw new ApiError('NOT_FOUND', 'expense category not found', 404);
    return { status: 200, body: { data } };
  });
}

export async function archiveExpenseCategory({ req, params }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'expenses.write');

  return respondWithIdempotency(req, caller, BUNDLE, `POST /expense-categories/${params.id}/archive`, {}, async () => {
    const { data, error } = await admin()
      .from('expense_categories')
      .update({ is_active: false, updated_by: caller.userId, updated_at: new Date().toISOString() })
      .eq('org_id', caller.orgId)
      .eq('id', params.id)
      .select(COLS)
      .maybeSingle();
    if (error) throw new ApiError('INTERNAL_ERROR', 'failed to archive expense category', 500, { db: error.message });
    if (!data) throw new ApiError('NOT_FOUND', 'expense category not found', 404);
    return { status: 200, body: { data } };
  });
}

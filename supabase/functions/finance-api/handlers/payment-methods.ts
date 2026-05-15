/**
 * finance-api — /payment-methods handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §7:
 *   GET    /payment-methods           — list
 *   POST   /payment-methods           — create
 *   PATCH  /payment-methods/:id       — update
 *   DELETE /payment-methods/:id       — hard delete
 *
 * Partial unique constraint `WHERE is_default` means at most one default
 * per org. We perform the same is_default shuffle pattern as taxes.ts:
 * un-default the prior, then update/insert. Payments table doesn't exist
 * yet so DELETE has no FK check (will be added when payments lands).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PaymentMethodCreateSchema,
  PaymentMethodPatchSchema,
  PaymentMethodSchema,
  type PaymentMethod,
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

const PM_COLS =
  'id, org_id, code, label, description, is_default, is_active, created_at, updated_at';

interface PaymentMethodRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  description: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToPm(row: PaymentMethodRow): PaymentMethod {
  return PaymentMethodSchema.parse(row);
}

// ======================================================== GET /payment-methods
export async function listPaymentMethods({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.payment_methods.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const isActive = url.searchParams.get('is_active');

    let query = admin()
      .from('payment_methods')
      .select(PM_COLS)
      .eq('org_id', caller.orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'payment method list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const rows = (data ?? []) as PaymentMethodRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToPm), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ======================================================= POST /payment-methods
export async function createPaymentMethod({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.payment_methods.write');
    const body = await parseBody(req, PaymentMethodCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /payment-methods',
      body,
      async () => {
        let priorDefaultId: string | null = null;
        if (body.is_default) priorDefaultId = await unsetPriorDefault(caller, null);

        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          description: body.description ?? null,
          is_default: body.is_default,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('payment_methods')
          .insert(insertRow)
          .select(PM_COLS)
          .single();
        if (error || !data) {
          if (priorDefaultId) await restoreDefault(caller, priorDefaultId);
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'payment method code already exists in this org',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'payment method insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToPm(data as PaymentMethodRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =================================================== PATCH /payment-methods/:id
export async function patchPaymentMethod({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.payment_methods.write');
    const body = await parseBody(req, PaymentMethodPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /payment-methods/:id',
      body,
      async () => {
        await fetchPmRow(caller, id);

        let priorDefaultId: string | null = null;
        if (body.is_default === true) priorDefaultId = await unsetPriorDefault(caller, id);

        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.description !== undefined) patch.description = body.description;
        if (body.is_default !== undefined) patch.is_default = body.is_default;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('payment_methods')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PM_COLS)
          .single();
        if (error || !data) {
          if (priorDefaultId) await restoreDefault(caller, priorDefaultId);
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'payment method code already exists in this org',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'payment method update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToPm(data as PaymentMethodRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================== DELETE /payment-methods/:id
export async function deletePaymentMethod({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.payment_methods.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /payment-methods/:id',
      { id },
      async () => {
        await fetchPmRow(caller, id);
        // Payments table not yet shipped; no FK check required.
        const { error } = await admin()
          .from('payment_methods')
          .delete()
          .eq('id', id)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'payment method delete failed', 500, {
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

// =========================================================================
// Internal helpers
// =========================================================================

async function fetchPmRow(caller: Caller, id: string): Promise<PaymentMethodRow> {
  const { data, error } = await admin()
    .from('payment_methods')
    .select(PM_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'payment method lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'payment method not found', 404);
  return data as PaymentMethodRow;
}

async function unsetPriorDefault(caller: Caller, excludeId: string | null): Promise<string | null> {
  let query = admin()
    .from('payment_methods')
    .select('id')
    .eq('org_id', caller.orgId)
    .eq('is_default', true);
  if (excludeId) query = query.neq('id', excludeId);
  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'default payment method lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) return null;
  const priorId = (data as { id: string }).id;
  const { error: updErr } = await admin()
    .from('payment_methods')
    .update({ is_default: false, updated_by: caller.userId })
    .eq('id', priorId)
    .eq('org_id', caller.orgId);
  if (updErr) {
    throw new ApiError('INTERNAL_ERROR', 'failed to clear prior default payment method', 500, {
      detail: updErr.message,
    });
  }
  return priorId;
}

async function restoreDefault(caller: Caller, id: string): Promise<void> {
  await admin()
    .from('payment_methods')
    .update({ is_default: true, updated_by: caller.userId })
    .eq('id', id)
    .eq('org_id', caller.orgId);
}

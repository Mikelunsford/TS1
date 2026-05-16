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
 * per org. Wave 6 / F-Wave6-01 routes the `is_default=true` branch through
 * the atomic `set_default_payment_method(p_org_id, p_method_id)` SECURITY
 * DEFINER RPC shipped in migration 0051 — eliminates the two-step UPDATE
 * race the prior best-effort-rollback pattern compensated for. Closes
 * R-W3-05 fully.
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
        // Always insert with is_default=false; if body.is_default=true, the
        // post-insert RPC atomically clears any prior default and flips this
        // row to default.
        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          description: body.description ?? null,
          is_default: false,
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

        let row = data as PaymentMethodRow;
        if (body.is_default) {
          row = await callSetDefaultPaymentMethod(caller, row.id);
        }
        return { status: 201, body: { data: rowToPm(row) } };
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

        // Build the patch excluding is_default — the RPC handles that branch
        // atomically below. is_default=false flips directly (no shuffle).
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.description !== undefined) patch.description = body.description;
        if (body.is_default === false) patch.is_default = false;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('payment_methods')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PM_COLS)
          .single();
        if (error || !data) {
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

        let row = data as PaymentMethodRow;
        if (body.is_default === true) {
          row = await callSetDefaultPaymentMethod(caller, id);
        }
        return { status: 200, body: { data: rowToPm(row) } };
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

/**
 * Calls `set_default_payment_method(p_org_id, p_method_id)` SECURITY DEFINER
 * RPC (migration 0051). Atomically clears any prior default in the org and
 * stamps the named row as `is_default=true`. Returns the post-RPC row for
 * response shaping.
 */
async function callSetDefaultPaymentMethod(
  caller: Caller,
  methodId: string,
): Promise<PaymentMethodRow> {
  const { error: rpcErr } = await admin().rpc('set_default_payment_method', {
    p_org_id: caller.orgId,
    p_method_id: methodId,
  });
  if (rpcErr) {
    throw new ApiError('INTERNAL_ERROR', 'set_default_payment_method RPC failed', 500, {
      detail: rpcErr.message,
    });
  }
  const { data, error } = await admin()
    .from('payment_methods')
    .select(PM_COLS)
    .eq('id', methodId)
    .eq('org_id', caller.orgId)
    .single();
  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'payment method re-fetch after RPC failed', 500, {
      detail: error?.message,
    });
  }
  return data as PaymentMethodRow;
}

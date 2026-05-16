/**
 * finance-api — /taxes handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §7:
 *   GET    /taxes                 — list (filters: is_active, is_default)
 *   GET    /taxes/:id             — detail
 *   POST   /taxes                 — create (rate is 0..1 decimal, NOT bp)
 *   PATCH  /taxes/:id             — update
 *   POST   /taxes/:id/archive     — sets is_active=false
 *
 * The DB column `rate` is `numeric(7,6)` (e.g. 0.0875 = 8.75%). The API
 * contract §7 originally proposed `rate_bp`; we expose `rate` on the wire
 * to match the DB. Documented in the Zod schema and in the dispatch brief.
 *
 * `is_default` shuffle (Wave 6 / F-Wave6-01 / closes R-W3-05 fully):
 * routes the `is_default=true` branch through the atomic
 * `set_default_tax(p_org_id, p_tax_id)` SECURITY DEFINER RPC shipped in
 * migration 0051. The RPC clears any prior default + stamps the new one
 * inside a single transaction; eliminates the two-step UPDATE race that
 * the prior best-effort-rollback pattern compensated for.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { TaxCreateSchema, TaxPatchSchema, TaxSchema, type Tax } from '../../_shared/types.ts';
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

const TAX_COLS =
  'id, org_id, code, label, rate, jurisdiction, is_compound, is_inclusive, ' +
  'is_default, is_active, created_at, updated_at';

interface TaxRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  rate: string | number;
  jurisdiction: string | null;
  is_compound: boolean;
  is_inclusive: boolean;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToTax(row: TaxRow): Tax {
  return TaxSchema.parse(row);
}

// ================================================================== GET /taxes
export async function listTaxes({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const isActive = url.searchParams.get('is_active');
    const isDefault = url.searchParams.get('is_default');

    let query = admin()
      .from('taxes')
      .select(TAX_COLS)
      .eq('org_id', caller.orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);
    if (isDefault === 'true') query = query.eq('is_default', true);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'tax list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as TaxRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToTax), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================== GET /taxes/:id
export async function getTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.read');
    const row = await fetchTaxRow(caller, params.id);
    return ok(rowToTax(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================================= POST /taxes
export async function createTax({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const body = await parseBody(req, TaxCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /taxes',
      body,
      async () => {
        // Always insert with is_default=false; if body.is_default=true, the
        // post-insert RPC atomically clears any prior default and flips this
        // row to default. Avoids the partial-unique-on-is_default race that
        // the prior unsetPriorDefault/restoreDefault pattern compensated for.
        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          rate: body.rate,
          jurisdiction: body.jurisdiction ?? null,
          is_compound: body.is_compound,
          is_inclusive: body.is_inclusive,
          is_default: false,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('taxes')
          .insert(insertRow)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'tax code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'tax insert failed', 500, {
            detail: error?.message,
          });
        }

        let row = data as TaxRow;
        if (body.is_default) {
          row = await callSetDefaultTax(caller, row.id);
        }
        return { status: 201, body: { data: rowToTax(row) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ PATCH /taxes/:id
export async function patchTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const body = await parseBody(req, TaxPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /taxes/:id',
      body,
      async () => {
        await fetchTaxRow(caller, id);

        // Build the patch excluding is_default — the RPC handles that branch
        // atomically below. is_default=false flips directly (no shuffle).
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.rate !== undefined) patch.rate = body.rate;
        if (body.jurisdiction !== undefined) patch.jurisdiction = body.jurisdiction;
        if (body.is_compound !== undefined) patch.is_compound = body.is_compound;
        if (body.is_inclusive !== undefined) patch.is_inclusive = body.is_inclusive;
        if (body.is_default === false) patch.is_default = false;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('taxes')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'tax code already exists in this org', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'tax update failed', 500, {
            detail: error?.message,
          });
        }

        let row = data as TaxRow;
        if (body.is_default === true) {
          row = await callSetDefaultTax(caller, id);
        }
        return { status: 200, body: { data: rowToTax(row) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =================================================== POST /taxes/:id/archive
export async function archiveTax({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.taxes.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /taxes/:id/archive',
      { id },
      async () => {
        await fetchTaxRow(caller, id);
        const { data, error } = await admin()
          .from('taxes')
          .update({ is_active: false, is_default: false, updated_by: caller.userId })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(TAX_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'tax archive failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToTax(data as TaxRow) } };
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

async function fetchTaxRow(caller: Caller, id: string): Promise<TaxRow> {
  const { data, error } = await admin()
    .from('taxes')
    .select(TAX_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'tax lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'tax not found', 404);
  return data as TaxRow;
}

/**
 * Calls `set_default_tax(p_org_id, p_tax_id)` SECURITY DEFINER RPC (migration
 * 0051). Atomically clears any prior default in the org and stamps the named
 * row as `is_default=true`. Returns the post-RPC row for response shaping.
 */
async function callSetDefaultTax(caller: Caller, taxId: string): Promise<TaxRow> {
  const { error: rpcErr } = await admin().rpc('set_default_tax', {
    p_org_id: caller.orgId,
    p_tax_id: taxId,
  });
  if (rpcErr) {
    throw new ApiError('INTERNAL_ERROR', 'set_default_tax RPC failed', 500, {
      detail: rpcErr.message,
    });
  }
  const { data, error } = await admin()
    .from('taxes')
    .select(TAX_COLS)
    .eq('id', taxId)
    .eq('org_id', caller.orgId)
    .single();
  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', 'tax re-fetch after RPC failed', 500, {
      detail: error?.message,
    });
  }
  return data as TaxRow;
}

/**
 * finance-api — /chart-of-accounts handlers (Wave 8 / Phase 12).
 *
 * Endpoints:
 *   GET    /chart-of-accounts              — list (filters: account_type,
 *                                              is_active, parent_id)
 *   POST   /chart-of-accounts              — create
 *   GET    /chart-of-accounts/:id          — detail
 *   PATCH  /chart-of-accounts/:id          — update; refuses if is_system=true
 *   POST   /chart-of-accounts/:id/archive  — sets is_active=false; refuses if
 *                                              is_system=true
 *
 * UNIQUE (org_id, account_code) on the table — 23505 on conflict surfaces as
 * 409 STATE_CONFLICT. parent_id is a self-FK ON DELETE SET NULL; we don't
 * validate the parent here beyond the FK (the DB enforces same-row referent;
 * cross-org parents are blocked by RLS during normal client use, and by the
 * org-scoped lookup in this handler for the rare service-role path).
 *
 * is_system marks chassis-seeded accounts (AR, AP, Sales, COGS, etc). Edits
 * and archives are 403 FORBIDDEN. The flag is set only by migrations.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ChartOfAccountCreateSchema,
  ChartOfAccountPatchSchema,
  ChartOfAccountSchema,
  type ChartOfAccount,
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

const COA_COLS =
  'id, org_id, account_code, label, account_type, parent_id, currency_code, ' +
  'description, is_active, is_system, created_at, updated_at';

interface CoaRow {
  id: string;
  org_id: string;
  account_code: string;
  label: string;
  account_type: string;
  parent_id: string | null;
  currency_code: string | null;
  description: string | null;
  is_active: boolean;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

function rowToCoa(row: CoaRow): ChartOfAccount {
  return ChartOfAccountSchema.parse(row);
}

async function fetchCoaRow(caller: Caller, id: string): Promise<CoaRow> {
  const { data, error } = await admin()
    .from('chart_of_accounts')
    .select(COA_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'chart_of_accounts row not found', 404);
  return data as CoaRow;
}

// =========================================================================
// GET /chart-of-accounts
// =========================================================================
export async function listChartOfAccounts({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.coa.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const accountType = url.searchParams.get('account_type');
    const isActive = url.searchParams.get('is_active');
    const parentId = url.searchParams.get('parent_id');

    let query = admin()
      .from('chart_of_accounts')
      .select(COA_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('account_code', { ascending: true })
      .order('id', { ascending: true })
      .limit(limit + 1);

    if (accountType) query = query.eq('account_type', accountType);
    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);
    if (parentId === 'null') query = query.is('parent_id', null);
    else if (parentId) query = query.eq('parent_id', parentId);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'chart_of_accounts list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const rows = (data ?? []) as CoaRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToCoa), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /chart-of-accounts/:id
// =========================================================================
export async function getChartOfAccount({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.coa.read');
    const row = await fetchCoaRow(caller, params.id);
    return ok(rowToCoa(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /chart-of-accounts
// =========================================================================
export async function createChartOfAccount({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.coa.write');
    const body = await parseBody(req, ChartOfAccountCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /chart-of-accounts',
      body,
      async () => {
        // If parent_id provided, verify it lives in caller's org.
        if (body.parent_id) {
          const { data: parent, error: pErr } = await admin()
            .from('chart_of_accounts')
            .select('id, org_id')
            .eq('id', body.parent_id)
            .eq('org_id', caller.orgId)
            .is('deleted_at', null)
            .maybeSingle();
          if (pErr) {
            throw new ApiError('INTERNAL_ERROR', 'parent account lookup failed', 500, {
              detail: pErr.message,
            });
          }
          if (!parent) {
            throw new ApiError('VALIDATION_ERROR', 'parent_id not found in caller org', 422);
          }
        }

        const insertRow = {
          org_id: caller.orgId,
          account_code: body.account_code,
          label: body.label,
          account_type: body.account_type,
          parent_id: body.parent_id ?? null,
          currency_code: body.currency_code ?? null,
          description: body.description ?? null,
          is_active: body.is_active ?? true,
          is_system: false,
          created_by: caller.userId,
          updated_by: caller.userId,
        };

        const { data, error } = await admin()
          .from('chart_of_accounts')
          .insert(insertRow)
          .select(COA_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              `account_code "${body.account_code}" already exists in this org`,
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToCoa(data as CoaRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /chart-of-accounts/:id
// =========================================================================
export async function patchChartOfAccount({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.coa.write');
    const body = await parseBody(req, ChartOfAccountPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /chart-of-accounts/:id',
      body,
      async () => {
        const existing = await fetchCoaRow(caller, id);
        if (existing.is_system) {
          throw new ApiError(
            'FORBIDDEN',
            'system accounts cannot be edited',
            403,
          );
        }

        // If parent_id is being set non-null, verify it lives in caller's
        // org and is not the row itself (FK already blocks the self-ref
        // case at write time; this is a clean 422).
        if (body.parent_id) {
          if (body.parent_id === id) {
            throw new ApiError('VALIDATION_ERROR', 'parent_id cannot reference self', 422);
          }
          const { data: parent, error: pErr } = await admin()
            .from('chart_of_accounts')
            .select('id, org_id')
            .eq('id', body.parent_id)
            .eq('org_id', caller.orgId)
            .is('deleted_at', null)
            .maybeSingle();
          if (pErr) {
            throw new ApiError('INTERNAL_ERROR', 'parent account lookup failed', 500, {
              detail: pErr.message,
            });
          }
          if (!parent) {
            throw new ApiError('VALIDATION_ERROR', 'parent_id not found in caller org', 422);
          }
        }

        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.account_code !== undefined) patch.account_code = body.account_code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.account_type !== undefined) patch.account_type = body.account_type;
        if (body.parent_id !== undefined) patch.parent_id = body.parent_id;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.description !== undefined) patch.description = body.description;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('chart_of_accounts')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(COA_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'account_code already exists in this org',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToCoa(data as CoaRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /chart-of-accounts/:id/archive
// =========================================================================
export async function archiveChartOfAccount({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.coa.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /chart-of-accounts/:id/archive',
      { id },
      async () => {
        const existing = await fetchCoaRow(caller, id);
        if (existing.is_system) {
          throw new ApiError(
            'FORBIDDEN',
            'system accounts cannot be archived',
            403,
          );
        }
        const { data, error } = await admin()
          .from('chart_of_accounts')
          .update({ is_active: false, updated_by: caller.userId })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(COA_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'chart_of_accounts archive failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToCoa(data as CoaRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

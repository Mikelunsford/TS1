/**
 * inventory-api — /item-categories handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §9:
 *   GET    /item-categories            — list (flat; SPA composes tree)
 *   POST   /item-categories            — create
 *   PATCH  /item-categories/:id        — update
 *   DELETE /item-categories/:id        — delete (409 if items reference it)
 *
 * Categories form a self-referential tree via `parent_id`. The list
 * endpoint returns a flat array — the SPA assembles the tree client-side
 * (same pattern crm-api uses for parent-child entities; keeps the wire
 * shape simple and lets components reshape as needed).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ItemCategoryCreateSchema,
  ItemCategoryPatchSchema,
  ItemCategorySchema,
  type ItemCategory,
} from '../../_shared/types.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../_helpers.ts';

const CAT_COLS =
  'id, org_id, code, label, parent_id, is_active, created_at, updated_at';

interface CategoryRow {
  id: string;
  org_id: string;
  code: string;
  label: string;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToCategory(row: CategoryRow): ItemCategory {
  return ItemCategorySchema.parse(row);
}

// ======================================================== GET /item-categories
export async function listItemCategories({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.item_categories.read');

    const { data, error } = await admin()
      .from('item_categories')
      .select(CAT_COLS)
      .eq('org_id', caller.orgId)
      .order('code', { ascending: true });
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'item category list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const items = ((data ?? []) as CategoryRow[]).map(rowToCategory);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ======================================================= POST /item-categories
export async function createItemCategory({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.item_categories.write');
    const body = await parseBody(req, ItemCategoryCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /item-categories',
      body,
      async () => {
        const insertRow = {
          org_id: caller.orgId,
          code: body.code,
          label: body.label,
          parent_id: body.parent_id ?? null,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('item_categories')
          .insert(insertRow)
          .select(CAT_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'item category code already exists in this org',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'item category insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToCategory(data as CategoryRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =================================================== PATCH /item-categories/:id
export async function patchItemCategory({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.item_categories.write');
    const body = await parseBody(req, ItemCategoryPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /item-categories/:id',
      body,
      async () => {
        await fetchCategoryRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.code !== undefined) patch.code = body.code;
        if (body.label !== undefined) patch.label = body.label;
        if (body.parent_id !== undefined) patch.parent_id = body.parent_id;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('item_categories')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(CAT_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'item category code already exists in this org',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'item category update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToCategory(data as CategoryRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================== DELETE /item-categories/:id
export async function deleteItemCategory({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.item_categories.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /item-categories/:id',
      { id },
      async () => {
        await fetchCategoryRow(caller, id);

        // FK check: refuse if any item references this category.
        const { count, error: refErr } = await admin()
          .from('items')
          .select('id', { head: true, count: 'exact' })
          .eq('org_id', caller.orgId)
          .eq('category_id', id)
          .is('deleted_at', null);
        if (refErr) {
          throw new ApiError('INTERNAL_ERROR', 'item reference check failed', 500, {
            detail: refErr.message,
          });
        }
        if ((count ?? 0) > 0) {
          throw new ApiError(
            'STATE_CONFLICT',
            'cannot delete item category referenced by items',
            409,
            { items_referencing: count },
          );
        }

        const { error } = await admin()
          .from('item_categories')
          .delete()
          .eq('id', id)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'item category delete failed', 500, {
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

async function fetchCategoryRow(caller: Caller, id: string): Promise<CategoryRow> {
  const { data, error } = await admin()
    .from('item_categories')
    .select(CAT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'item category lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'item category not found', 404);
  return data as CategoryRow;
}

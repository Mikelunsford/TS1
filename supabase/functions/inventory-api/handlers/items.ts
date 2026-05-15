/**
 * inventory-api — /items handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §9:
 *   GET    /items                     — list (category_id, q, is_active, is_inventoried)
 *   GET    /items/:id                 — detail
 *   POST   /items                     — create
 *   PATCH  /items/:id                 — update
 *   POST   /items/:id/archive         — soft delete (deleted_at + is_active=false)
 *
 * `public.items` (renamed from pricing_menu in migration 0049). The legacy
 * free-text `category` column lives alongside the new `category_id` FK
 * for back-compat with the 34 pre-Wave-0 seed rows; the wire schema
 * exposes both. RLS Pattern A — every query scoped by org_id.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ItemCreateSchema,
  ItemPatchSchema,
  ItemSchema,
  type Item,
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

const ITEM_COLS =
  'id, org_id, item_code, description, category, category_id, item_kind, ' +
  'markup_pct, unit_price_cents, unit_cost_cents, currency_code, unit_id, ' +
  'tax_id, is_inventoried, reorder_point, is_active, created_at, updated_at';

interface ItemRow {
  id: string;
  org_id: string;
  item_code: string;
  description: string;
  category: string | null;
  category_id: string | null;
  item_kind: 'labor' | 'material' | 'pass_through' | 'fee' | 'service';
  markup_pct: string | number | null;
  unit_price_cents: string | number;
  unit_cost_cents: string | number;
  currency_code: string | null;
  unit_id: string | null;
  tax_id: string | null;
  is_inventoried: boolean;
  reorder_point: string | number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToItem(row: ItemRow): Item {
  return ItemSchema.parse(row);
}

// ================================================================== GET /items
export async function listItems({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.items.read');

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const categoryId = url.searchParams.get('category_id');
    const q = url.searchParams.get('q');
    const isActive = url.searchParams.get('is_active');
    const isInventoried = url.searchParams.get('is_inventoried');

    let query = admin()
      .from('items')
      .select(ITEM_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (categoryId) query = query.eq('category_id', categoryId);
    if (q) query = query.ilike('description', `%${q}%`);
    if (isActive === 'true') query = query.eq('is_active', true);
    else if (isActive === 'false') query = query.eq('is_active', false);
    if (isInventoried === 'true') query = query.eq('is_inventoried', true);
    else if (isInventoried === 'false') query = query.eq('is_inventoried', false);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'item list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as ItemRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToItem), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================== GET /items/:id
export async function getItem({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.items.read');
    const row = await fetchItemRow(caller, params.id);
    return ok(rowToItem(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ================================================================= POST /items
export async function createItem({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.items.write');
    const body = await parseBody(req, ItemCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /items',
      body,
      async () => {
        const insertRow = {
          org_id: caller.orgId,
          item_code: body.item_code,
          description: body.description,
          item_kind: body.item_kind,
          category: body.category ?? null,
          category_id: body.category_id ?? null,
          markup_pct: body.markup_pct ?? null,
          unit_price_cents: body.unit_price_cents,
          unit_cost_cents: body.unit_cost_cents,
          currency_code: body.currency_code ?? null,
          unit_id: body.unit_id ?? null,
          tax_id: body.tax_id ?? null,
          is_inventoried: body.is_inventoried,
          reorder_point: body.reorder_point ?? null,
          is_active: body.is_active,
          created_by: caller.userId,
          updated_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('items')
          .insert(insertRow)
          .select(ITEM_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'item_code already exists', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'item insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToItem(data as ItemRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ============================================================ PATCH /items/:id
export async function patchItem({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.items.write');
    const body = await parseBody(req, ItemPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /items/:id',
      body,
      async () => {
        await fetchItemRow(caller, id);
        const patch: Record<string, unknown> = { updated_by: caller.userId };
        if (body.item_code !== undefined) patch.item_code = body.item_code;
        if (body.description !== undefined) patch.description = body.description;
        if (body.item_kind !== undefined) patch.item_kind = body.item_kind;
        if (body.category !== undefined) patch.category = body.category;
        if (body.category_id !== undefined) patch.category_id = body.category_id;
        if (body.markup_pct !== undefined) patch.markup_pct = body.markup_pct;
        if (body.unit_price_cents !== undefined) patch.unit_price_cents = body.unit_price_cents;
        if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.unit_id !== undefined) patch.unit_id = body.unit_id;
        if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
        if (body.is_inventoried !== undefined) patch.is_inventoried = body.is_inventoried;
        if (body.reorder_point !== undefined) patch.reorder_point = body.reorder_point;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('items')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(ITEM_COLS)
          .single();
        if (error || !data) {
          if (error?.code === '23505') {
            throw new ApiError('STATE_CONFLICT', 'item_code already exists', 409);
          }
          throw new ApiError('INTERNAL_ERROR', 'item update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToItem(data as ItemRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =================================================== POST /items/:id/archive
export async function archiveItem({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'inventory.items.write');
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /items/:id/archive',
      { id },
      async () => {
        await fetchItemRow(caller, id);
        const { data, error } = await admin()
          .from('items')
          .update({
            deleted_at: new Date().toISOString(),
            is_active: false,
            updated_by: caller.userId,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(ITEM_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'item archive failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToItem(data as ItemRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

async function fetchItemRow(caller: Caller, id: string): Promise<ItemRow> {
  const { data, error } = await admin()
    .from('items')
    .select(ITEM_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'item lookup failed', 500, { detail: error.message });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'item not found', 404);
  return data as ItemRow;
}

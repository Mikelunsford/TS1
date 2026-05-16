/**
 * inventory-api — /stock-levels handlers (Wave 8d / Phase 13).
 *
 * READ-ONLY surface. quantity_available is a GENERATED column; quantity_on_hand
 * is maintained by the recompute_stock_level trigger fired off stock_movements
 * AIUD. Writes flow through POST /stock-movements/adjustment (or the (deferred)
 * receiving / shipping auto-emit triggers).
 *
 * Routes:
 *   GET /stock-levels                   — list (filters: item_id, warehouse_id,
 *                                          low_stock=true)
 *   GET /stock-levels/by-item-warehouse — single row lookup by composite key
 *                                          (?item_id=&warehouse_id=)
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  StockLevelSchema,
  type StockLevel,
} from '../../_shared/types.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseLimit,
  requireCap,
} from '../_helpers.ts';

const SL_COLS =
  'id, org_id, item_id, warehouse_id, quantity_on_hand, quantity_reserved, ' +
  'quantity_available, last_counted_at, created_at, updated_at';

interface StockLevelRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  quantity_on_hand: string | number;
  quantity_reserved: string | number;
  quantity_available: string | number;
  last_counted_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToStockLevel(row: StockLevelRow): StockLevel {
  return StockLevelSchema.parse(row);
}

// ============================================================= GET /stock-levels
export async function listStockLevels({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.stock.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const itemId = url.searchParams.get('item_id');
  const warehouseId = url.searchParams.get('warehouse_id');
  const lowStock = url.searchParams.get('low_stock');

  let qb = admin()
    .from('stock_levels')
    .select(SL_COLS)
    .eq('org_id', caller.orgId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (itemId) qb = qb.eq('item_id', itemId);
  if (warehouseId) qb = qb.eq('warehouse_id', warehouseId);
  // low_stock=true: items where quantity_available <= 0 (no reorder_point in
  // stock_levels — handler caller can post-filter by joining items if they need
  // per-item reorder_point thresholds; this gives a fast "out of stock" cut).
  if (lowStock === 'true') qb = qb.lte('quantity_available', 0);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'stock_levels list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as StockLevelRow[];
  const { items, next_cursor } = paginate(rows, limit);
  return ok({ items: items.map(rowToStockLevel), next_cursor }, undefined, { req });
}

// ============================================ GET /stock-levels/by-item-warehouse
export async function getStockLevelByItemWarehouse({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.stock.read');

  const itemId = url.searchParams.get('item_id');
  const warehouseId = url.searchParams.get('warehouse_id');
  if (!itemId || !warehouseId) {
    throw new ApiError('VALIDATION_ERROR', 'item_id and warehouse_id query params are required', 400);
  }
  const { data, error } = await admin()
    .from('stock_levels')
    .select(SL_COLS)
    .eq('org_id', caller.orgId)
    .eq('item_id', itemId)
    .eq('warehouse_id', warehouseId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'stock_levels lookup failed', 500, { detail: error.message });
  }
  if (!data) {
    // Zero-stock view: return a synthetic 0/0/0 row instead of 404 so the SPA
    // doesn't have to special-case "never had stock" vs "currently zero".
    return ok({
      id: null,
      org_id: caller.orgId,
      item_id: itemId,
      warehouse_id: warehouseId,
      quantity_on_hand: 0,
      quantity_reserved: 0,
      quantity_available: 0,
      last_counted_at: null,
      created_at: null,
      updated_at: null,
    }, undefined, { req });
  }
  return ok(rowToStockLevel(data as StockLevelRow), undefined, { req });
}

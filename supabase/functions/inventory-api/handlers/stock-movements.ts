/**
 * inventory-api — /stock-movements handlers (Wave 8d / Phase 13).
 *
 * The stock_movements table is APPEND-ONLY (RLS grants SELECT only to
 * authenticated; INSERT/UPDATE/DELETE are service-role only). The recompute
 * trigger keeps stock_levels in sync on every INSERT.
 *
 * Routes:
 *   GET  /stock-movements                — list (cursor; filters: item_id,
 *                                            warehouse_id, movement_type,
 *                                            reference_type, from, to)
 *   POST /stock-movements/adjustment     — manual sign-bearing adjustment;
 *                                            movement_type='adjustment',
 *                                            reference_type='manual'
 *
 * Auto-emit receipt/shipment/consumption movements from ops-api workflow
 * transitions is DEFERRED per R-W8D-INTEGRATION-01 (bom_items has no item_id
 * FK; resolving items from BOM rows or "project finished goods" needs schema
 * not in scope for Wave 8d).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  StockMovementAdjustmentSchema,
  StockMovementSchema,
  type StockMovement,
} from '../../_shared/types.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
} from '../_helpers.ts';

const SM_COLS =
  'id, org_id, item_id, warehouse_id, movement_type, quantity, unit_cost_cents, ' +
  'reference_type, reference_id, notes, occurred_at, created_at, created_by';

interface StockMovementRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  movement_type:
    | 'receipt' | 'shipment' | 'adjustment'
    | 'transfer_in' | 'transfer_out' | 'consumption' | 'return';
  quantity: string | number;
  unit_cost_cents: string | number;
  reference_type:
    | 'receiving_order' | 'shipment' | 'production_consumption'
    | 'purchase_order' | 'manual' | null;
  reference_id: string | null;
  notes: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
}

function rowToStockMovement(row: StockMovementRow): StockMovement {
  return StockMovementSchema.parse(row);
}

// ========================================================== GET /stock-movements
export async function listStockMovements({ req, url }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.stock.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const itemId = url.searchParams.get('item_id');
  const warehouseId = url.searchParams.get('warehouse_id');
  const movementType = url.searchParams.get('movement_type');
  const referenceType = url.searchParams.get('reference_type');
  const referenceId = url.searchParams.get('reference_id');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let qb = admin()
    .from('stock_movements')
    .select(SM_COLS)
    .eq('org_id', caller.orgId)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (itemId) qb = qb.eq('item_id', itemId);
  if (warehouseId) qb = qb.eq('warehouse_id', warehouseId);
  if (movementType) qb = qb.eq('movement_type', movementType);
  if (referenceType) qb = qb.eq('reference_type', referenceType);
  if (referenceId) qb = qb.eq('reference_id', referenceId);
  if (from) qb = qb.gte('occurred_at', from);
  if (to) qb = qb.lte('occurred_at', to);
  if (cursor) {
    qb = qb.or(
      `occurred_at.lt.${cursor.created_at},and(occurred_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'stock_movements list failed', 500, { detail: error.message });
  }
  const rows = (data ?? []) as StockMovementRow[];
  // paginate uses created_at as the cursor field, but we order by occurred_at;
  // remap last row's occurred_at into created_at slot for cursor synthesis.
  const cursorRows = rows.map((r) => ({ ...r, created_at: r.occurred_at }));
  const { items: cursorItems, next_cursor } = paginate(cursorRows, limit);
  // The handler returns the original rows (with both occurred_at and created_at
  // preserved) for the IDs that survived the cursor cut.
  const keptIds = new Set(cursorItems.map((r) => r.id));
  const items = rows.filter((r) => keptIds.has(r.id)).map(rowToStockMovement);
  return ok({ items, next_cursor }, undefined, { req });
}

// ============================================== POST /stock-movements/adjustment
export async function createStockMovementAdjustment({ req }: Ctx): Promise<Response> {
  const caller = requireCaller(req);
  requireCap(caller, 'inventory.stock.write');
  const body = await parseBody(req, StockMovementAdjustmentSchema);

  return respondWithIdempotency(
    req,
    caller,
    'POST /stock-movements/adjustment',
    body,
    async () => {
      // Verify warehouse belongs to caller's org.
      const { data: wh, error: whErr } = await admin()
        .from('warehouses')
        .select('id')
        .eq('id', body.warehouse_id)
        .eq('org_id', caller.orgId)
        .maybeSingle();
      if (whErr) {
        throw new ApiError('INTERNAL_ERROR', 'warehouse lookup failed', 500, { detail: whErr.message });
      }
      if (!wh) throw new ApiError('NOT_FOUND', 'warehouse not found in org', 404);

      // Verify item belongs to caller's org.
      const { data: it, error: itErr } = await admin()
        .from('items')
        .select('id')
        .eq('id', body.item_id)
        .eq('org_id', caller.orgId)
        .is('deleted_at', null)
        .maybeSingle();
      if (itErr) {
        throw new ApiError('INTERNAL_ERROR', 'item lookup failed', 500, { detail: itErr.message });
      }
      if (!it) throw new ApiError('NOT_FOUND', 'item not found in org', 404);

      // Adjustment is sign-bearing; the trigger sums it as-is.
      const insertRow = {
        org_id: caller.orgId,
        item_id: body.item_id,
        warehouse_id: body.warehouse_id,
        movement_type: 'adjustment',
        quantity: body.quantity_delta,
        unit_cost_cents: body.unit_cost_cents ?? 0,
        reference_type: 'manual',
        reference_id: null,
        notes: body.notes ?? null,
        occurred_at: body.occurred_at ?? new Date().toISOString(),
        created_by: caller.userId,
      };

      const { data, error } = await admin()
        .from('stock_movements')
        .insert(insertRow)
        .select(SM_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'stock_movement insert failed', 500, {
          detail: error?.message,
        });
      }
      return { status: 201, body: { data: rowToStockMovement(data as StockMovementRow) } };
    },
  );
}

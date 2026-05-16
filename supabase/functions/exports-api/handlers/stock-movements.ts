/**
 * exports-api — /exports/stock_movements CSV stream.
 * Append-only table; gated on inventory.stock.read + inventory.enabled.
 * Filters: ?item_id, ?warehouse_id, ?movement_type, ?reference_type,
 *          ?start/?end (created_at).
 */
import { makeExportHandler } from './_factory.ts';

interface SmRow {
  id: string;
  org_id: string;
  item_id: string;
  warehouse_id: string;
  movement_type: string;
  quantity: number | string;
  unit_cost_cents: number | string;
  reference_type: string | null;
  reference_id: string | null;
  notes: string | null;
  occurred_at: string;
  created_at: string;
  created_by: string | null;
}

export const exportStockMovements = makeExportHandler<SmRow>({
  slug: 'stock_movements',
  table: 'stock_movements',
  cols:
    'id, org_id, item_id, warehouse_id, movement_type, quantity, unit_cost_cents, ' +
    'reference_type, reference_id, notes, occurred_at, created_at, created_by',
  headers: [
    'id',
    'item_id',
    'warehouse_id',
    'movement_type',
    'quantity',
    'unit_cost_cents',
    'reference_type',
    'reference_id',
    'notes',
    'occurred_at',
    'created_at',
    'created_by',
  ],
  toRow: (r) => [
    r.id,
    r.item_id,
    r.warehouse_id,
    r.movement_type,
    r.quantity,
    r.unit_cost_cents,
    r.reference_type,
    r.reference_id,
    r.notes,
    r.occurred_at,
    r.created_at,
    r.created_by,
  ],
  cap: 'inventory.stock.read',
  flagKey: 'inventory.enabled',
  // Append-only — no deleted_at column.
  skipSoftDeleteFilter: true,
  applyFilters: (qb, url) => {
    const itemId = url.searchParams.get('item_id');
    const warehouseId = url.searchParams.get('warehouse_id');
    const movementType = url.searchParams.get('movement_type');
    const referenceType = url.searchParams.get('reference_type');
    if (itemId) qb = qb.eq('item_id', itemId);
    if (warehouseId) qb = qb.eq('warehouse_id', warehouseId);
    if (movementType) qb = qb.eq('movement_type', movementType);
    if (referenceType) qb = qb.eq('reference_type', referenceType);
    return qb;
  },
});

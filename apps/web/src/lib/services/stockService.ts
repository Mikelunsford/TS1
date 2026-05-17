/**
 * Stock service (Wave 8f / Phase 13 SPA). Wraps the inventory-api
 * /stock-levels (read-only) and /stock-movements (read + manual adjustment)
 * surfaces added in Wave 8d (PR #69).
 *
 * stock_movements is append-only — POST /stock-movements/adjustment is the
 * only write path. quantity_available on stock_levels is a GENERATED column
 * (qoh - qreserved STORED) and is never written by callers.
 *
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  StockLevelSchema,
  StockMovementSchema,
  type StockLevel,
  type StockMovement,
  type StockMovementAdjustment,
} from '../types';

const StockLevelListSchema = z.object({
  items: z.array(StockLevelSchema),
  next_cursor: z.string().nullable(),
});

const StockMovementListSchema = z.object({
  items: z.array(StockMovementSchema),
  next_cursor: z.string().nullable(),
});

export interface StockLevelListFilters {
  item_id?: string;
  warehouse_id?: string;
  low_stock?: boolean;
  limit?: number;
  cursor?: string;
  // R-W8F-OBS-02 — set to ['item'] to populate `level.item` with an ItemMini
  // (id + item_code + description + item_kind) on every row in the response.
  expand?: ReadonlyArray<'item'>;
}

export interface StockMovementListFilters {
  item_id?: string;
  warehouse_id?: string;
  movement_type?: string;
  reference_type?: string;
  reference_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toLevelQuery(filters: StockLevelListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.item_id) sp.set('item_id', filters.item_id);
  if (filters.warehouse_id) sp.set('warehouse_id', filters.warehouse_id);
  if (filters.low_stock) sp.set('low_stock', 'true');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  if (filters.expand?.length) sp.set('expand', filters.expand.join(','));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function toMovementQuery(filters: StockMovementListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.item_id) sp.set('item_id', filters.item_id);
  if (filters.warehouse_id) sp.set('warehouse_id', filters.warehouse_id);
  if (filters.movement_type) sp.set('movement_type', filters.movement_type);
  if (filters.reference_type) sp.set('reference_type', filters.reference_type);
  if (filters.reference_id) sp.set('reference_id', filters.reference_id);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listStockLevels(filters?: StockLevelListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/stock-levels${toLevelQuery(filters)}`,
    schema: StockLevelListSchema,
  });
}

export function listStockMovements(filters?: StockMovementListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/stock-movements${toMovementQuery(filters)}`,
    schema: StockMovementListSchema,
  });
}

/**
 * Manual stock adjustment. `quantity_delta` may be negative (decrease) or
 * positive (increase); the BE rejects zero with VALIDATION_ERROR (422).
 * Sets movement_type='adjustment', reference_type='manual' server-side.
 */
export function adjustStock(body: StockMovementAdjustment): Promise<StockMovement> {
  return apiRequest({
    method: 'POST',
    path: '/inventory-api/stock-movements/adjustment',
    body,
    schema: StockMovementSchema,
  });
}

// Re-exported for caller convenience.
export type { StockLevel, StockMovement };

/**
 * inventory-api — route table.
 *
 * Wave 3 / Phase 3 sales chassis: items, item categories, units.
 * Wave 8d / Phase 13: warehouses, stock_levels, stock_movements.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { withFlag } from '../_shared/withFlag.ts';
import {
  archiveItem,
  createItem,
  getItem,
  listItems,
  patchItem,
} from './handlers/items.ts';
import {
  createItemCategory,
  deleteItemCategory,
  listItemCategories,
  patchItemCategory,
} from './handlers/item-categories.ts';
import {
  createUnit,
  deleteUnit,
  listUnits,
  patchUnit,
} from './handlers/units.ts';
import {
  archiveWarehouse,
  createWarehouse,
  getWarehouse,
  listWarehouses,
  patchWarehouse,
} from './handlers/warehouses.ts';
import {
  getStockLevelByItemWarehouse,
  listStockLevels,
} from './handlers/stock-levels.ts';
import {
  createStockMovementAdjustment,
  listStockMovements,
} from './handlers/stock-movements.ts';

const BUNDLE = 'inventory-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Items
  { method: 'GET', path: '/items', handler: listItems },
  { method: 'POST', path: '/items', handler: createItem },
  { method: 'GET', path: '/items/:id', handler: getItem },
  { method: 'PATCH', path: '/items/:id', handler: patchItem },
  { method: 'POST', path: '/items/:id/archive', handler: archiveItem },

  // Item Categories
  { method: 'GET', path: '/item-categories', handler: listItemCategories },
  { method: 'POST', path: '/item-categories', handler: createItemCategory },
  { method: 'PATCH', path: '/item-categories/:id', handler: patchItemCategory },
  { method: 'DELETE', path: '/item-categories/:id', handler: deleteItemCategory },

  // Units
  { method: 'GET', path: '/units', handler: listUnits },
  { method: 'POST', path: '/units', handler: createUnit },
  { method: 'PATCH', path: '/units/:id', handler: patchUnit },
  { method: 'DELETE', path: '/units/:id', handler: deleteUnit },

  // Warehouses (Wave 8d) — Phase 15 gated on inventory.enabled
  { method: 'GET', path: '/warehouses', handler: withFlag('inventory.enabled', listWarehouses) },
  { method: 'POST', path: '/warehouses', handler: withFlag('inventory.enabled', createWarehouse) },
  { method: 'GET', path: '/warehouses/:id', handler: withFlag('inventory.enabled', getWarehouse) },
  { method: 'PATCH', path: '/warehouses/:id', handler: withFlag('inventory.enabled', patchWarehouse) },
  { method: 'POST', path: '/warehouses/:id/archive', handler: withFlag('inventory.enabled', archiveWarehouse) },

  // Stock Levels (read-only) (Wave 8d) — Phase 15 gated on inventory.enabled
  { method: 'GET', path: '/stock-levels', handler: withFlag('inventory.enabled', listStockLevels) },
  { method: 'GET', path: '/stock-levels/by-item-warehouse', handler: withFlag('inventory.enabled', getStockLevelByItemWarehouse) },

  // Stock Movements (Wave 8d) — Phase 15 gated on inventory.enabled
  { method: 'GET', path: '/stock-movements', handler: withFlag('inventory.enabled', listStockMovements) },
  { method: 'POST', path: '/stock-movements/adjustment', handler: withFlag('inventory.enabled', createStockMovementAdjustment) },
];

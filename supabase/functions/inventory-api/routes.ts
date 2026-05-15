/**
 * inventory-api — route table.
 *
 * Wave 3 / Phase 3 sales chassis: items, item categories, units.
 * Warehouses, stock movements, stock levels land in later waves.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
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
];

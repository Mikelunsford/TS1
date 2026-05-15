/**
 * inventory-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'inventory-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.11
  //   GET    /items                                   — list with category, q
  //   POST   /items                                   — create
  //   GET    /items/:id                               — detail
  //   PATCH  /items/:id                               — update
  //   POST   /items/:id/archive                       — archive
  //
  //   GET    /item-categories                         — tree
  //   POST   /item-categories                         — create
  //   PATCH  /item-categories/:id                     — update
  //
  //   GET    /units                                   — list
  //   POST   /units                                   — create
  //
  //   GET    /warehouses                              — list
  //   POST   /warehouses                              — create
  //   PATCH  /warehouses/:id                          — update
  //
  //   GET    /stock-movements?item_id=&warehouse_id=  — list
  //   POST   /stock-movements                         — manual adjust
  //   GET    /stock-levels                            — current stock-on-hand per item per warehouse
];

/**
 * ops-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'ops-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.7
  //   GET    /receiving-orders?project_id=                 — list
  //   POST   /receiving-orders                             — create RO header
  //   GET    /receiving-orders/:id                         — detail with lines
  //   PATCH  /receiving-orders/:id                         — update header
  //   POST   /receiving-orders/:id/receive                 — mark received; emits stock_movements
  //   POST   /receiving-orders/:id/cancel                  — cancel pending
  //
  //   GET    /production-runs?project_id=                  — list
  //   POST   /production-runs                              — create (only one active per project)
  //   GET    /production-runs/:id                          — detail with consumption + builds
  //   PATCH  /production-runs/:id                          — update header
  //   POST   /production-runs/:id/start                    — move to in_progress
  //   POST   /production-runs/:id/complete                 — move to done; emits final reports
  //   POST   /production-runs/:id/cancel                   — cancel
  //   POST   /production-runs/:id/build-reports            — append build report
  //   POST   /production-runs/:id/consumption              — record consumption
  //
  //   GET    /shipments?project_id=                        — list
  //   POST   /shipments                                    — create header
  //   GET    /shipments/:id                                — detail
  //   PATCH  /shipments/:id                                — update
  //   POST   /shipments/:id/ship                           — move to shipped; emits stock_movements
  //   POST   /shipments/:id/cancel                         — cancel pending
  //   POST   /shipments/:id/manifest                       — generate manifest PDF
];

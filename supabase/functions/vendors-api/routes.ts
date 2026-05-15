/**
 * vendors-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'vendors-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.10
  //   GET    /vendors                                 — list
  //   POST   /vendors                                 — create
  //   GET    /vendors/:id                             — detail
  //   PATCH  /vendors/:id                             — update
  //   POST   /vendors/:id/archive                     — archive
  //
  //   GET    /purchase-orders                         — list
  //   POST   /purchase-orders                         — draft
  //   GET    /purchase-orders/:id                     — detail with lines
  //   PATCH  /purchase-orders/:id                     — edit draft
  //   POST   /purchase-orders/:id/issue               — move to issued
  //   POST   /purchase-orders/:id/send                — email vendor
  //   POST   /purchase-orders/:id/receive             — link to a receiving order
  //   POST   /purchase-orders/:id/close               — close
  //   GET    /purchase-orders/:id/pdf                 — stream PDF
  //
  //   GET    /vendor-bills                            — list
  //   POST   /vendor-bills                            — create
  //   GET    /vendor-bills/:id                        — detail
  //   PATCH  /vendor-bills/:id                        — update
  //   POST   /vendor-bills/:id/approve                — approve
  //   POST   /vendor-bills/:id/pay                    — pay
];

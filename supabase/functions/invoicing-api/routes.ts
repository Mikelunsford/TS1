/**
 * invoicing-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'invoicing-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.8
  //   GET    /invoices                                       — list with status, customer, date, currency
  //   POST   /invoices                                       — create draft
  //   GET    /invoices/:id                                   — detail with lines, payments, credit notes
  //   PATCH  /invoices/:id                                   — edit draft
  //   POST   /invoices/:id/issue                             — move to issued; allocates number
  //   POST   /invoices/:id/send                              — email
  //   POST   /invoices/:id/void                              — void with reason
  //   POST   /invoices/:id/duplicate                         — clone draft
  //   GET    /invoices/:id/pdf                               — stream PDF
  //   GET    /invoices/:id/versions                          — list versions
  //
  //   GET    /invoices/:invoice_id/line-items                — list
  //   POST   /invoices/:invoice_id/line-items                — bulk replace / append
  //   PATCH  /invoices/:invoice_id/line-items/:id            — edit one
  //   DELETE /invoices/:invoice_id/line-items/:id            — remove one
  //
  //   GET    /payments                                       — list
  //   POST   /payments                                       — record payment; auto-allocates
  //   GET    /payments/:id                                   — detail with allocations
  //   PATCH  /payments/:id                                   — edit unposted
  //   POST   /payments/:id/void                              — void; reverses allocations
  //   POST   /payments/:id/allocate                          — add/replace allocation map
  //
  //   GET    /credit-notes                                   — list
  //   POST   /credit-notes                                   — create
  //   GET    /credit-notes/:id                               — detail
  //   POST   /credit-notes/:id/apply                         — apply to an invoice
  //   POST   /credit-notes/:id/void                          — void
];

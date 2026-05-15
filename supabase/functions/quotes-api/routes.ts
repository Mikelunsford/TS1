/**
 * quotes-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'quotes-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.5
  //   GET    /quotes                                       — list with status, customer, date
  //   POST   /quotes                                       — create draft
  //   GET    /quotes/:id                                   — detail (lines, attachments, versions)
  //   PATCH  /quotes/:id                                   — edit draft
  //   POST   /quotes/:id/submit                            — submit for approval
  //   POST   /quotes/:id/approve                           — approve submitted
  //   POST   /quotes/:id/send                              — email to customer
  //   POST   /quotes/:id/decline                           — customer-side decline
  //   POST   /quotes/:id/accept                            — customer-side accept
  //   POST   /quotes/:id/convert-to-project                — create project
  //   POST   /quotes/:id/duplicate                         — clone as new draft
  //   GET    /quotes/:id/pdf                               — stream PDF
  //   GET    /quotes/:id/versions                          — list versions
  //
  //   GET    /quotes/:quote_id/line-items                  — list
  //   POST   /quotes/:quote_id/line-items                  — bulk replace / append
  //   PATCH  /quotes/:quote_id/line-items/:id              — edit one
  //   DELETE /quotes/:quote_id/line-items/:id              — remove one
  //   POST   /quotes/:quote_id/line-items/reorder          — set new order
];

/**
 * projects-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'projects-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.6
  //   GET    /projects                                    — list
  //   POST   /projects                                    — create (typically by quote convert)
  //   GET    /projects/:id                                — detail (phases, BOM, RO, runs, shipments)
  //   PATCH  /projects/:id                                — update header
  //   POST   /projects/:id/close                          — final close
  //   POST   /projects/:id/reopen                         — reopen closed
  //   GET    /projects/:id/pdf                            — stream PDF
  //
  //   GET    /projects/:project_id/phases                 — list
  //   POST   /projects/:project_id/phases                 — add phase
  //   PATCH  /projects/:project_id/phases/:id             — update
  //   DELETE /projects/:project_id/phases/:id             — remove
  //   POST   /projects/:project_id/phases/reorder         — set order
  //
  //   GET    /projects/:id/dispositions                   — list
  //   POST   /projects/:id/dispositions                   — record disposition
];

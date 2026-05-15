/**
 * crm-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'crm-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.4
  //   GET    /customers                              — list with filters: q, status, tag, kind
  //   POST   /customers                              — create
  //   GET    /customers/:id                          — detail
  //   PATCH  /customers/:id                          — update
  //   POST   /customers/:id/archive                  — soft-delete
  //   POST   /customers/:id/restore                  — undo archive
  //   GET    /customers/:id/comments                 — list comments
  //   POST   /customers/:id/comments                 — add comment (emits mentions)
  //   GET    /customers/:id/attachments              — list attachments
  //   POST   /customers/:id/attachments/sign-upload  — signed PUT URL
  //   DELETE /customers/:id/attachments/:att_id      — remove attachment
  //
  //   GET    /contacts?customer_id=...               — list contacts
  //   POST   /contacts                               — create
  //   GET    /contacts/:id                           — detail
  //   PATCH  /contacts/:id                           — update
  //   DELETE /contacts/:id                           — hard-delete
  //
  //   GET    /leads                                  — list with status, owner, source
  //   POST   /leads                                  — create
  //   GET    /leads/:id                              — detail
  //   PATCH  /leads/:id                              — update
  //   POST   /leads/:id/qualify                      — transition new -> qualified
  //   POST   /leads/:id/disqualify                   — transition to disqualified
  //
  //   GET    /opportunities                          — kanban pull by stage
  //   POST   /opportunities                          — create
  //   GET    /opportunities/:id                      — detail
  //   PATCH  /opportunities/:id                      — update incl. stage move
  //   POST   /opportunities/:id/win                  — mark won, optionally create quote
  //   POST   /opportunities/:id/lose                 — mark lost
  //
  //   GET    /activities?entity_type=&entity_id=     — polymorphic timeline
  //   POST   /activities                             — log call/meeting/email/note
  //   PATCH  /activities/:id                         — edit
  //   DELETE /activities/:id                         — remove
];

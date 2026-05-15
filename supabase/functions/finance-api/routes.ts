/**
 * finance-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'finance-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.9
  //   GET    /taxes                                   — list
  //   POST   /taxes                                   — create
  //   GET    /taxes/:id                               — detail
  //   PATCH  /taxes/:id                               — update
  //   POST   /taxes/:id/archive                       — archive
  //
  //   GET    /currencies                              — list (global + org rows)
  //   POST   /currencies                              — enable currency for org
  //   PATCH  /currencies/:code                        — update display
  //   GET    /exchange-rates?base=&quote=&from=&to=   — range query
  //   POST   /exchange-rates                          — manual rate insert
  //
  //   GET    /expenses                                — list (own scope for submitter)
  //   POST   /expenses                                — submit expense
  //   GET    /expenses/:id                            — detail
  //   PATCH  /expenses/:id                            — edit pending
  //   POST   /expenses/:id/approve                    — approve
  //   POST   /expenses/:id/reject                     — reject with reason
  //
  //   GET    /expense-categories                      — list
  //   POST   /expense-categories                      — create
  //   PATCH  /expense-categories/:id                  — update
  //
  //   GET    /chart-of-accounts                       — tree
  //   POST   /chart-of-accounts                       — create account
  //   PATCH  /chart-of-accounts/:id                   — update
  //   POST   /chart-of-accounts/:id/archive           — archive
  //
  //   GET    /journal-entries                         — list with date range
  //   POST   /journal-entries                         — draft entry
  //   GET    /journal-entries/:id                     — detail
  //   POST   /journal-entries/:id/post                — post (irreversible)
  //   POST   /journal-entries/:id/reverse             — generate reversal
];

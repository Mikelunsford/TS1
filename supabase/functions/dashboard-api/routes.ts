/**
 * dashboard-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { getDashboardSummary } from './handlers/summary.ts';

const BUNDLE = 'dashboard-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // Dashboard polish (Wave 10) — A1 owns this block.
  { method: 'GET', path: '/dashboard/summary', handler: getDashboardSummary },
  // End Dashboard polish (Wave 10).
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.12
  //   GET    /dashboard/summary                       — KPI tiles per role
  //   GET    /dashboard/activity                      — recent activity feed
  //   GET    /dashboard/aging                         — AR aging buckets
  //   GET    /dashboard/cash-flow                     — 30-day projection
  //
  //   GET    /search                                  — cross-entity search (pg_trgm)
  //   GET    /search/recent                           — recently visited entities for caller
  //
  //   GET    /notifications                           — list own; query unread_only
  //   POST   /notifications/:id/read                  — mark one read
  //   POST   /notifications/read-all                  — mark all read
  //   GET    /notifications/preferences               — per-event delivery prefs
  //   PUT    /notifications/preferences               — update prefs
  //
  //   GET    /saved-views?entity=                     — list own + shared
  //   POST   /saved-views                             — create
  //   PATCH  /saved-views/:id                         — update (own only)
  //   DELETE /saved-views/:id                         — delete (own only)
  //   POST   /saved-views/:id/share                   — toggle shared flag
  //
  //   GET    /audit-log                               — filter by entity, user, action, date
  //   GET    /audit-log/:id                           — detail with diff
  //
  //   POST   /telemetry/errors                        — SPA ErrorBoundary sink
];

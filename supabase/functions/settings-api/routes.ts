/**
 * settings-api — route table.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

const BUNDLE = 'settings-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  // TODO Wave 1+: per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.3
  //   GET    /settings                              — read flattened settings JSON
  //   PATCH  /settings                              — deep-merge patch into the JSON
  //   GET    /feature-flags                         — read all flags for active org
  //   PUT    /feature-flags/:key                    — set a flag on/off
  //   GET    /numbering                             — read numbering format strings
  //   PATCH  /numbering                             — update numbering format strings
  //   GET    /integrations                          — list configured integrations
  //   POST   /integrations/:kind                    — create/update an integration
];

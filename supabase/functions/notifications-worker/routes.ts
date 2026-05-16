/**
 * notifications-worker — route table.
 * Phase 19 (Wave 10 Session 3).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { drainNotifications } from './handlers/drain.ts';

const BUNDLE = 'notifications-worker';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  { method: 'POST', path: '/drain', handler: drainNotifications },
];

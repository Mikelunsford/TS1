/**
 * search-api — route table (Phase 17).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { globalSearch } from './handlers/search.ts';

const BUNDLE = 'search-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },
  { method: 'GET', path: '/search', handler: globalSearch },
];

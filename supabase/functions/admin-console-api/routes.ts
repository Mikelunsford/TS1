/**
 * admin-console-api — route table (Phase 23 — Wave 10 Session 4).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { adminMe } from './handlers/me.ts';
import {
  listOrganizations,
  getOrganization,
  provisionOrganization,
  suspendOrganization,
  unsuspendOrganization,
} from './handlers/organizations.ts';
import {
  impersonate,
  endImpersonation,
  impersonationHistory,
} from './handlers/impersonate.ts';

const BUNDLE = 'admin-console-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Identity
  { method: 'GET',  path: '/admin/me',                             handler: adminMe },

  // Organizations
  { method: 'GET',  path: '/admin/organizations',                  handler: listOrganizations },
  { method: 'POST', path: '/admin/organizations',                  handler: provisionOrganization },
  { method: 'GET',  path: '/admin/organizations/:id',              handler: getOrganization },
  { method: 'POST', path: '/admin/organizations/:id/suspend',      handler: suspendOrganization },
  { method: 'POST', path: '/admin/organizations/:id/unsuspend',    handler: unsuspendOrganization },

  // Impersonation
  { method: 'POST', path: '/admin/impersonate',                    handler: impersonate },
  { method: 'POST', path: '/admin/impersonate/end',                handler: endImpersonation },
  { method: 'GET',  path: '/admin/impersonation-history',          handler: impersonationHistory },
];

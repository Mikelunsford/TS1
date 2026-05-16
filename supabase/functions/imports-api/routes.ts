/**
 * imports-api — route table.
 *
 * Phase 20 (Wave 10): validate-then-commit CSV upload. Every state-changing
 * route requires Idempotency-Key (the factory wires this through
 * respondWithIdempotency).
 *
 * The preview route returns errors + first-20-row preview; the commit route
 * re-validates the same payload and bulk-inserts via service-role.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import { commitCustomers, previewCustomers } from './handlers/customers.ts';
import { commitItems, previewItems } from './handlers/items.ts';
import { commitVendors, previewVendors } from './handlers/vendors.ts';

const BUNDLE = 'imports-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Customers
  { method: 'POST', path: '/imports/customers', handler: previewCustomers },
  { method: 'POST', path: '/imports/customers/commit', handler: commitCustomers },

  // Items
  { method: 'POST', path: '/imports/items', handler: previewItems },
  { method: 'POST', path: '/imports/items/commit', handler: commitItems },

  // Vendors
  { method: 'POST', path: '/imports/vendors', handler: previewVendors },
  { method: 'POST', path: '/imports/vendors/commit', handler: commitVendors },
];

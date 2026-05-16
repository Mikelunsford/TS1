/**
 * vendor-portal-api — route table (Phase 22 / Wave 10 Session 4 / C2).
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import { getMe } from './handlers/me.ts';
import {
  acknowledgePO,
  getPO,
  listPOs,
} from './handlers/purchase-orders.ts';
import {
  getStatement,
  getVendorBill,
  listPayments,
  listVendorBills,
} from './handlers/vendor-bills.ts';

const BUNDLE = 'vendor-portal-api';

// Prefix-stripping note: the shared router already strips `/vendor-portal-api`;
// vendor portal callers conventionally also hit `/vendor-portal/*` so we
// register both rooted patterns. The empty-prefix variant is what the
// router actually sees once `bundlePath` strips `/functions/v1/<bundle>`.
export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Health alias (matches `/vendor-portal` if no bundle prefix stripping).
  {
    method: 'GET',
    path: '/vendor-portal',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // /me — bundle-rooted form.
  { method: 'GET', path: '/me', handler: getMe },
  { method: 'GET', path: '/vendor-portal/me', handler: getMe },

  // /purchase-orders
  { method: 'GET', path: '/purchase-orders', handler: listPOs },
  { method: 'GET', path: '/vendor-portal/purchase-orders', handler: listPOs },
  { method: 'GET', path: '/purchase-orders/:id', handler: getPO },
  { method: 'GET', path: '/vendor-portal/purchase-orders/:id', handler: getPO },
  { method: 'POST', path: '/purchase-orders/:id/acknowledge', handler: acknowledgePO },
  { method: 'POST', path: '/vendor-portal/purchase-orders/:id/acknowledge', handler: acknowledgePO },

  // /vendor-bills
  { method: 'GET', path: '/vendor-bills', handler: listVendorBills },
  { method: 'GET', path: '/vendor-portal/vendor-bills', handler: listVendorBills },
  { method: 'GET', path: '/vendor-bills/:id', handler: getVendorBill },
  { method: 'GET', path: '/vendor-portal/vendor-bills/:id', handler: getVendorBill },

  // /payments (derived)
  { method: 'GET', path: '/payments', handler: listPayments },
  { method: 'GET', path: '/vendor-portal/payments', handler: listPayments },

  // /statements (AP aging snapshot)
  { method: 'GET', path: '/statements', handler: getStatement },
  { method: 'GET', path: '/vendor-portal/statements', handler: getStatement },
];

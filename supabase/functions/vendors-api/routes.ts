/**
 * vendors-api — route table.
 *
 * Wave 7 / Phase 10: full procurement surface — vendors CRUD, purchase
 * orders + line items + workflow, vendor bills + workflow. All non-GET
 * routes are wrapped in respondWithIdempotency by their handler.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';

import {
  archiveVendor,
  createVendor,
  getVendor,
  listVendors,
  patchVendor,
} from './handlers/vendors.ts';
import {
  addPOLineItem,
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  deletePOLineItem,
  getPurchaseOrder,
  listPurchaseOrders,
  patchPOLineItem,
  patchPurchaseOrder,
  receivePurchaseOrder,
  submitPurchaseOrder,
} from './handlers/purchase-orders.ts';
import {
  approveVendorBill,
  cancelVendorBill,
  createVendorBill,
  getVendorBill,
  listVendorBills,
  patchVendorBill,
  payVendorBill,
  submitVendorBill,
} from './handlers/vendor-bills.ts';

const BUNDLE = 'vendors-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Vendors
  { method: 'GET', path: '/vendors', handler: listVendors },
  { method: 'POST', path: '/vendors', handler: createVendor },
  { method: 'GET', path: '/vendors/:id', handler: getVendor },
  { method: 'PATCH', path: '/vendors/:id', handler: patchVendor },
  { method: 'POST', path: '/vendors/:id/archive', handler: archiveVendor },

  // Purchase orders
  { method: 'GET', path: '/purchase-orders', handler: listPurchaseOrders },
  { method: 'POST', path: '/purchase-orders', handler: createPurchaseOrder },
  { method: 'GET', path: '/purchase-orders/:id', handler: getPurchaseOrder },
  { method: 'PATCH', path: '/purchase-orders/:id', handler: patchPurchaseOrder },
  { method: 'POST', path: '/purchase-orders/:id/submit', handler: submitPurchaseOrder },
  { method: 'POST', path: '/purchase-orders/:id/approve', handler: approvePurchaseOrder },
  { method: 'POST', path: '/purchase-orders/:id/cancel', handler: cancelPurchaseOrder },
  { method: 'POST', path: '/purchase-orders/:id/close', handler: closePurchaseOrder },
  { method: 'POST', path: '/purchase-orders/:id/receive', handler: receivePurchaseOrder },

  // PO line items
  { method: 'POST', path: '/purchase-orders/:id/lines', handler: addPOLineItem },
  { method: 'PATCH', path: '/purchase-orders/:id/lines/:lineId', handler: patchPOLineItem },
  { method: 'DELETE', path: '/purchase-orders/:id/lines/:lineId', handler: deletePOLineItem },

  // Vendor bills
  { method: 'GET', path: '/vendor-bills', handler: listVendorBills },
  { method: 'POST', path: '/vendor-bills', handler: createVendorBill },
  { method: 'GET', path: '/vendor-bills/:id', handler: getVendorBill },
  { method: 'PATCH', path: '/vendor-bills/:id', handler: patchVendorBill },
  { method: 'POST', path: '/vendor-bills/:id/submit', handler: submitVendorBill },
  { method: 'POST', path: '/vendor-bills/:id/approve', handler: approveVendorBill },
  { method: 'POST', path: '/vendor-bills/:id/pay', handler: payVendorBill },
  { method: 'POST', path: '/vendor-bills/:id/cancel', handler: cancelVendorBill },
];

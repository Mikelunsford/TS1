/**
 * ops-api — route table.
 *
 * Wave 8d / Phase 13: real routes for receiving_orders / production_runs /
 * shipments land here. The bundle gate at index.ts (Wave 6 / PR #57) already
 * protects every non-health route with the plugins.3pl feature flag — orgs
 * without the flag get 404 for everything except GET /.
 *
 * Per TS1/09-api/01-EDGE-FUNCTIONS-MAP.md §2.7. Stock movement integration
 * (auto-emit on receive/ship/complete) is deferred per R-W8D-INTEGRATION-01.
 */

import type { Route } from '../_shared/route.ts';
import { ok } from '../_shared/responses.ts';
import {
  cancelReceivingOrder,
  createReceivingOrder,
  getReceivingOrder,
  listReceivingOrders,
  patchReceivingOrder,
  receiveReceivingOrder,
} from './handlers/receiving-orders.ts';
import {
  cancelProductionRun,
  completeProductionRun,
  createProductionRun,
  getProductionRun,
  listProductionRuns,
  patchProductionRun,
  startProductionRun,
} from './handlers/production-runs.ts';
import {
  cancelShipment,
  createShipment,
  getShipment,
  listShipments,
  patchShipment,
  shipShipment,
  startLoadingShipment,
} from './handlers/shipments.ts';

const BUNDLE = 'ops-api';

export const routes: Route[] = [
  {
    method: 'GET',
    path: '/',
    handler: ({ req }) => ok({ ok: true, bundle: BUNDLE }, undefined, { req }),
  },

  // Receiving orders
  { method: 'GET', path: '/receiving-orders', handler: listReceivingOrders },
  { method: 'POST', path: '/receiving-orders', handler: createReceivingOrder },
  { method: 'GET', path: '/receiving-orders/:id', handler: getReceivingOrder },
  { method: 'PATCH', path: '/receiving-orders/:id', handler: patchReceivingOrder },
  { method: 'POST', path: '/receiving-orders/:id/receive', handler: receiveReceivingOrder },
  { method: 'POST', path: '/receiving-orders/:id/cancel', handler: cancelReceivingOrder },

  // Production runs
  { method: 'GET', path: '/production-runs', handler: listProductionRuns },
  { method: 'POST', path: '/production-runs', handler: createProductionRun },
  { method: 'GET', path: '/production-runs/:id', handler: getProductionRun },
  { method: 'PATCH', path: '/production-runs/:id', handler: patchProductionRun },
  { method: 'POST', path: '/production-runs/:id/start', handler: startProductionRun },
  { method: 'POST', path: '/production-runs/:id/complete', handler: completeProductionRun },
  { method: 'POST', path: '/production-runs/:id/cancel', handler: cancelProductionRun },

  // Shipments
  { method: 'GET', path: '/shipments', handler: listShipments },
  { method: 'POST', path: '/shipments', handler: createShipment },
  { method: 'GET', path: '/shipments/:id', handler: getShipment },
  { method: 'PATCH', path: '/shipments/:id', handler: patchShipment },
  { method: 'POST', path: '/shipments/:id/start-loading', handler: startLoadingShipment },
  { method: 'POST', path: '/shipments/:id/ship', handler: shipShipment },
  { method: 'POST', path: '/shipments/:id/cancel', handler: cancelShipment },
];

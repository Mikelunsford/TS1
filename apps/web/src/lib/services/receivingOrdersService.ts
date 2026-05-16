/**
 * Receiving orders service (Wave 8f / Phase 13 SPA). Wraps the ops-api
 * /receiving-orders surface added in Wave 8d (PR #69). Bundle is gated
 * on plugins.3pl on the BE; SPA hides nav + routes when the cap is
 * absent.
 *
 * Workflow: open → partial → received (terminal); cancellable from
 * open/partial. `receive` body carries the absolute cumulative
 * `received_qty` (NOT a delta) and the handler picks the right next
 * state.
 *
 * See TS1/09-api/00-API-CONTRACT.md §13 + EDGE-FUNCTIONS-MAP §2.7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ReceivingOrderSchema,
  type ReceivingOrder,
  type ReceivingOrderCreate,
  type ReceivingOrderPatch,
  type ReceivingOrderReceive,
} from '../types';

const ReceivingOrderListSchema = z.object({
  items: z.array(ReceivingOrderSchema),
  next_cursor: z.string().nullable(),
});

export interface ReceivingOrderListFilters {
  status?: string;
  project_id?: string;
  source?: string;
  bom_item_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ReceivingOrderListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.project_id) sp.set('project_id', filters.project_id);
  if (filters.source) sp.set('source', filters.source);
  if (filters.bom_item_id) sp.set('bom_item_id', filters.bom_item_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listReceivingOrders(filters?: ReceivingOrderListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/receiving-orders${toQuery(filters)}`,
    schema: ReceivingOrderListSchema,
  });
}

export function getReceivingOrder(id: string): Promise<ReceivingOrder> {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/receiving-orders/${id}`,
    schema: ReceivingOrderSchema,
  });
}

export function createReceivingOrder(body: ReceivingOrderCreate): Promise<ReceivingOrder> {
  return apiRequest({
    method: 'POST',
    path: '/ops-api/receiving-orders',
    body,
    schema: ReceivingOrderSchema,
  });
}

export function updateReceivingOrder(
  id: string,
  body: ReceivingOrderPatch,
): Promise<ReceivingOrder> {
  return apiRequest({
    method: 'PATCH',
    path: `/ops-api/receiving-orders/${id}`,
    body,
    schema: ReceivingOrderSchema,
  });
}

export function receiveReceivingOrder(
  id: string,
  body: ReceivingOrderReceive,
): Promise<ReceivingOrder> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/receiving-orders/${id}/receive`,
    body,
    schema: ReceivingOrderSchema,
  });
}

export function cancelReceivingOrder(id: string): Promise<ReceivingOrder> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/receiving-orders/${id}/cancel`,
    body: {},
    schema: ReceivingOrderSchema,
  });
}

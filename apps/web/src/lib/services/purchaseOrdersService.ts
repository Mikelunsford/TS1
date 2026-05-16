/**
 * Purchase orders service (Wave 7 / Phase 10). Wraps the procurement
 * surface of vendors-api. GET /purchase-orders/:id returns the header
 * with an inline `lines` array. See TS1/09-api/00-API-CONTRACT.md §10.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  POLineItemSchema,
  PurchaseOrderSchema,
  type POLineItem,
  type PurchaseOrder,
  type PurchaseOrderCreate,
  type PurchaseOrderPatch,
  type PurchaseOrderReceive,
} from '../types';

const PurchaseOrderListSchema = z.object({
  items: z.array(PurchaseOrderSchema),
  next_cursor: z.string().nullable(),
});

/** PO detail response includes inline line items. */
export const PurchaseOrderDetailSchema = PurchaseOrderSchema.extend({
  lines: z.array(POLineItemSchema),
});
export type PurchaseOrderDetail = z.infer<typeof PurchaseOrderDetailSchema>;

export interface PurchaseOrderListFilters {
  q?: string;
  status?: string;
  vendor_id?: string;
  project_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: PurchaseOrderListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.vendor_id) sp.set('vendor_id', filters.vendor_id);
  if (filters.project_id) sp.set('project_id', filters.project_id);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listPurchaseOrders(filters?: PurchaseOrderListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/purchase-orders${toQuery(filters)}`,
    schema: PurchaseOrderListSchema,
  });
}

export function getPurchaseOrder(id: string): Promise<PurchaseOrderDetail> {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/purchase-orders/${id}`,
    schema: PurchaseOrderDetailSchema,
  });
}

export function createPurchaseOrder(body: PurchaseOrderCreate): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: '/vendors-api/purchase-orders',
    body,
    schema: PurchaseOrderSchema,
  });
}

export function updatePurchaseOrder(
  id: string,
  body: PurchaseOrderPatch,
): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'PATCH',
    path: `/vendors-api/purchase-orders/${id}`,
    body,
    schema: PurchaseOrderSchema,
  });
}

export function submitPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${id}/submit`,
    body: {},
    schema: PurchaseOrderSchema,
  });
}

export function approvePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${id}/approve`,
    body: {},
    schema: PurchaseOrderSchema,
  });
}

export function cancelPurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${id}/cancel`,
    body: {},
    schema: PurchaseOrderSchema,
  });
}

export function closePurchaseOrder(id: string): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${id}/close`,
    body: {},
    schema: PurchaseOrderSchema,
  });
}

/** Partial receive — body lists per-line `quantity_received` updates. */
export function receivePurchaseOrder(
  id: string,
  body: PurchaseOrderReceive,
): Promise<PurchaseOrder> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${id}/receive`,
    body,
    schema: PurchaseOrderSchema,
  });
}

// Re-exported for callers that want to use the inline line type.
export type { POLineItem };

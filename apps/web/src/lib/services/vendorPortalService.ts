/**
 * Vendor portal service (Phase 22 / Wave 10 Session 4 / C2).
 * Wraps the vendor-portal-api edge function in typed calls.
 *
 * The portal API returns slimmer payloads than vendors-api (no org_id /
 * deleted_at) — we keep schemas permissive with .passthrough() so the
 * SPA can evolve without breaking the contract test.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  CentsSchema,
  POLineItemSchema,
  PurchaseOrderSchema,
  TimestampSchema,
  UuidSchema,
  VendorBillSchema,
  VendorSchema,
  type PurchaseOrder,
} from '../types';

const VendorPortalMeSchema = z.object({
  vendor: VendorSchema.partial().passthrough(),
  user_id: UuidSchema,
  org_id: UuidSchema,
  role: z.string(),
});
export type VendorPortalMe = z.infer<typeof VendorPortalMeSchema>;

const PurchaseOrderListSchema = z.object({
  items: z.array(PurchaseOrderSchema.partial().passthrough()),
  next_cursor: z.string().nullable(),
});

const PurchaseOrderDetailSchema = PurchaseOrderSchema.partial()
  .extend({ lines: z.array(POLineItemSchema.partial().passthrough()) })
  .passthrough();
export type PurchaseOrderDetail = z.infer<typeof PurchaseOrderDetailSchema>;

const VendorBillListSchema = z.object({
  items: z.array(VendorBillSchema.partial().passthrough()),
  next_cursor: z.string().nullable(),
});

const PaymentItemSchema = z
  .object({
    id: UuidSchema,
    bill_number: z.string(),
    currency_code: z.string().length(3),
    paid_cents: CentsSchema,
    paid_at: TimestampSchema.nullable(),
    total_cents: CentsSchema,
    created_at: TimestampSchema,
  })
  .passthrough();
export type PaymentItem = z.infer<typeof PaymentItemSchema>;

const PaymentListSchema = z.object({
  items: z.array(PaymentItemSchema),
  next_cursor: z.string().nullable(),
});

const StatementSchema = z.object({
  as_of: z.string(),
  vendor_id: UuidSchema,
  buckets: z.object({
    current: z.number(),
    d30: z.number(),
    d60: z.number(),
    d90: z.number(),
    d90plus: z.number(),
  }),
  total_outstanding_cents: z.number(),
  open_bills: z.array(z.unknown()),
});
export type Statement = z.infer<typeof StatementSchema>;

export interface PortalListFilters {
  status?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: PortalListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function getVendorPortalMe() {
  return apiRequest({
    method: 'GET',
    path: '/vendor-portal-api/me',
    schema: VendorPortalMeSchema,
  });
}

export function listPortalPurchaseOrders(filters?: PortalListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/purchase-orders${toQuery(filters)}`,
    schema: PurchaseOrderListSchema,
  });
}

export function getPortalPurchaseOrder(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/purchase-orders/${id}`,
    schema: PurchaseOrderDetailSchema,
  });
}

const PurchaseOrderAckSchema = z.object({
  id: UuidSchema,
  acknowledged_at: TimestampSchema,
});

export function acknowledgePortalPurchaseOrder(id: string) {
  return apiRequest({
    method: 'POST',
    path: `/vendor-portal-api/purchase-orders/${id}/acknowledge`,
    body: {},
    schema: PurchaseOrderAckSchema,
  });
}

export function listPortalVendorBills(filters?: PortalListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/vendor-bills${toQuery(filters)}`,
    schema: VendorBillListSchema,
  });
}

export function getPortalVendorBill(id: string) {
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/vendor-bills/${id}`,
    schema: VendorBillSchema.partial().passthrough(),
  });
}

export function listPortalPayments(filters?: PortalListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/payments${toQuery(filters)}`,
    schema: PaymentListSchema,
  });
}

export function getPortalStatement(asOf?: string) {
  const q = asOf ? `?as_of=${encodeURIComponent(asOf)}` : '';
  return apiRequest({
    method: 'GET',
    path: `/vendor-portal-api/statements${q}`,
    schema: StatementSchema,
  });
}

export type { PurchaseOrder };

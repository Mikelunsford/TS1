/**
 * Vendor bills service (Wave 7 / Phase 10). Header-only — no line items
 * table in prod (D-W7-6). `balance_cents` is maintained by the BIU trigger
 * added in migration 0058; clients read only.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  VendorBillSchema,
  type VendorBill,
  type VendorBillCreate,
  type VendorBillPatch,
  type VendorBillPay,
} from '../types';

const VendorBillListSchema = z.object({
  items: z.array(VendorBillSchema),
  next_cursor: z.string().nullable(),
});

export interface VendorBillListFilters {
  q?: string;
  status?: string;
  vendor_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: VendorBillListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.vendor_id) sp.set('vendor_id', filters.vendor_id);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listVendorBills(filters?: VendorBillListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/vendor-bills${toQuery(filters)}`,
    schema: VendorBillListSchema,
  });
}

export function getVendorBill(id: string): Promise<VendorBill> {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/vendor-bills/${id}`,
    schema: VendorBillSchema,
  });
}

export function createVendorBill(body: VendorBillCreate): Promise<VendorBill> {
  return apiRequest({
    method: 'POST',
    path: '/vendors-api/vendor-bills',
    body,
    schema: VendorBillSchema,
  });
}

export function updateVendorBill(id: string, body: VendorBillPatch): Promise<VendorBill> {
  return apiRequest({
    method: 'PATCH',
    path: `/vendors-api/vendor-bills/${id}`,
    body,
    schema: VendorBillSchema,
  });
}

export function submitVendorBill(id: string): Promise<VendorBill> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/vendor-bills/${id}/submit`,
    body: {},
    schema: VendorBillSchema,
  });
}

export function approveVendorBill(id: string): Promise<VendorBill> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/vendor-bills/${id}/approve`,
    body: {},
    schema: VendorBillSchema,
  });
}

export function cancelVendorBill(id: string): Promise<VendorBill> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/vendor-bills/${id}/cancel`,
    body: {},
    schema: VendorBillSchema,
  });
}

/** Pay (or partial-pay) a vendor bill. Omitting amount_cents pays remaining
 *  balance. BE auto-transitions to `partially_paid` or `paid` based on the
 *  running total. */
export function payVendorBill(id: string, body: VendorBillPay = {}): Promise<VendorBill> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/vendor-bills/${id}/pay`,
    body,
    schema: VendorBillSchema,
  });
}

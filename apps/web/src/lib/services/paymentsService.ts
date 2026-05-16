/**
 * Payments service. See TS1/09-api/00-API-CONTRACT.md §6 (DB-wins reconcile).
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  PaymentSchema,
  type Payment,
  type PaymentCreate,
  type PaymentPatch,
  type PaymentVoid,
} from '../types';

const PaymentListSchema = z.object({
  items: z.array(PaymentSchema),
  next_cursor: z.string().nullable(),
});

export interface PaymentListFilters {
  customer_id?: string;
  invoice_id?: string;
  currency_code?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: PaymentListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.invoice_id) sp.set('invoice_id', filters.invoice_id);
  if (filters.currency_code) sp.set('currency_code', filters.currency_code);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listPayments(filters?: PaymentListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/payments${toQuery(filters)}`,
    schema: PaymentListSchema,
  });
}

export function getPayment(id: string): Promise<Payment> {
  return apiRequest({
    method: 'GET',
    path: `/invoicing-api/payments/${id}`,
    schema: PaymentSchema,
  });
}

export function createPayment(body: PaymentCreate): Promise<Payment> {
  return apiRequest({
    method: 'POST',
    path: '/invoicing-api/payments',
    body,
    schema: PaymentSchema,
  });
}

export function updatePayment(id: string, body: PaymentPatch): Promise<Payment> {
  return apiRequest({
    method: 'PATCH',
    path: `/invoicing-api/payments/${id}`,
    body,
    schema: PaymentSchema,
  });
}

export function voidPayment(id: string, body: PaymentVoid): Promise<Payment> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/payments/${id}/void`,
    body,
    schema: PaymentSchema,
  });
}

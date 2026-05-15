/**
 * Payment methods service. Wraps the finance-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  PaymentMethodSchema,
  type PaymentMethod,
  type PaymentMethodCreate,
  type PaymentMethodPatch,
} from '../types';

const PaymentMethodListSchema = z.object({
  items: z.array(PaymentMethodSchema),
  next_cursor: z.string().nullable(),
});

const DeleteResultSchema = z.object({ ok: z.literal(true) });

export interface PaymentMethodListFilters {
  is_active?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: PaymentMethodListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.is_active !== undefined) sp.set('is_active', filters.is_active ? 'true' : 'false');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listPaymentMethods(filters?: PaymentMethodListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/payment-methods${toQuery(filters)}`,
    schema: PaymentMethodListSchema,
  });
}

export function createPaymentMethod(body: PaymentMethodCreate): Promise<PaymentMethod> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/payment-methods',
    body,
    schema: PaymentMethodSchema,
  });
}

export function updatePaymentMethod(
  id: string,
  body: PaymentMethodPatch,
): Promise<PaymentMethod> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/payment-methods/${id}`,
    body,
    schema: PaymentMethodSchema,
  });
}

export function deletePaymentMethod(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/finance-api/payment-methods/${id}`,
    body: {},
    schema: DeleteResultSchema,
  });
}

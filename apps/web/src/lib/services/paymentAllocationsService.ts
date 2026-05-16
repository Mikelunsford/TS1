/**
 * Payment-allocations service (Wave 8 / Phase 12). Wraps:
 *   POST /invoicing-api/payments/:id/allocate
 *
 * The endpoint returns the refreshed Payment row on success. The SPA
 * reads existing allocations directly from the BE via a Supabase query
 * against `payment_allocations` (RLS-gated to the caller's org), since
 * there is no dedicated list route. See `listPaymentAllocations` below.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { supabase } from '../supabase';
import {
  PaymentAllocationSchema,
  PaymentSchema,
  type PaymentAllocate,
  type PaymentAllocation,
  type Payment,
} from '../types';

export function allocatePayment(
  paymentId: string,
  body: PaymentAllocate,
): Promise<Payment> {
  return apiRequest({
    method: 'POST',
    path: `/invoicing-api/payments/${paymentId}/allocate`,
    body,
    schema: PaymentSchema,
  });
}

/**
 * Read existing live allocations for a payment via PostgREST. RLS scopes
 * the result to the caller's org.
 */
export async function listPaymentAllocations(paymentId: string): Promise<PaymentAllocation[]> {
  const { data, error } = await supabase
    .from('payment_allocations')
    .select('*')
    .eq('payment_id', paymentId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return z.array(PaymentAllocationSchema).parse(data ?? []);
}

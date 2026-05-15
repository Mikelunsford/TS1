/**
 * Customers service. Wraps the crm-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §3.1.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  CustomerSchema,
  type Customer,
  type CustomerCreate,
  type CustomerPatch,
} from '../types';

const CustomerListSchema = z.object({
  items: z.array(CustomerSchema),
  next_cursor: z.string().nullable(),
});

export interface CustomerListFilters {
  q?: string;
  status?: string;
  kind?: 'company' | 'individual';
  include_archived?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: CustomerListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.status) sp.set('status', filters.status);
  if (filters.kind) sp.set('kind', filters.kind);
  if (filters.include_archived) sp.set('include_archived', 'true');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listCustomers(filters?: CustomerListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/customers${toQuery(filters)}`,
    schema: CustomerListSchema,
  });
}

export function getCustomer(id: string): Promise<Customer> {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/customers/${id}`,
    schema: CustomerSchema,
  });
}

export function createCustomer(body: CustomerCreate): Promise<Customer> {
  return apiRequest({
    method: 'POST',
    path: '/crm-api/customers',
    body,
    schema: CustomerSchema,
  });
}

export function updateCustomer(id: string, body: CustomerPatch): Promise<Customer> {
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/customers/${id}`,
    body,
    schema: CustomerSchema,
  });
}

export function archiveCustomer(id: string): Promise<Customer> {
  return apiRequest({
    method: 'POST',
    path: `/crm-api/customers/${id}/archive`,
    body: {},
    schema: CustomerSchema,
  });
}

export function restoreCustomer(id: string): Promise<Customer> {
  return apiRequest({
    method: 'POST',
    path: `/crm-api/customers/${id}/restore`,
    body: {},
    schema: CustomerSchema,
  });
}

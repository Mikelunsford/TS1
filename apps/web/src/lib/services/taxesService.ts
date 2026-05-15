/**
 * Taxes service. Wraps the finance-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { TaxSchema, type Tax, type TaxCreate, type TaxPatch } from '../types';

const TaxListSchema = z.object({
  items: z.array(TaxSchema),
  next_cursor: z.string().nullable(),
});

export interface TaxListFilters {
  is_active?: boolean;
  is_default?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: TaxListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.is_active !== undefined) sp.set('is_active', filters.is_active ? 'true' : 'false');
  if (filters.is_default !== undefined) sp.set('is_default', filters.is_default ? 'true' : 'false');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listTaxes(filters?: TaxListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/taxes${toQuery(filters)}`,
    schema: TaxListSchema,
  });
}

export function getTax(id: string): Promise<Tax> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/taxes/${id}`,
    schema: TaxSchema,
  });
}

export function createTax(body: TaxCreate): Promise<Tax> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/taxes',
    body,
    schema: TaxSchema,
  });
}

export function updateTax(id: string, body: TaxPatch): Promise<Tax> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/taxes/${id}`,
    body,
    schema: TaxSchema,
  });
}

export function archiveTax(id: string): Promise<Tax> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/taxes/${id}/archive`,
    body: {},
    schema: TaxSchema,
  });
}

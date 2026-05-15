/**
 * Currencies service. Wraps the finance-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  CurrencySchema,
  type Currency,
  type CurrencyPatch,
  type CurrencyUpsert,
} from '../types';

const CurrencyListSchema = z.object({
  items: z.array(CurrencySchema),
  next_cursor: z.string().nullable(),
});

export interface CurrencyListFilters {
  is_active?: boolean;
}

function toQuery(filters: CurrencyListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.is_active !== undefined) sp.set('is_active', filters.is_active ? 'true' : 'false');
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listCurrencies(filters?: CurrencyListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/currencies${toQuery(filters)}`,
    schema: CurrencyListSchema,
  });
}

export function upsertCurrency(body: CurrencyUpsert): Promise<Currency> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/currencies',
    body,
    schema: CurrencySchema,
  });
}

export function updateCurrency(code: string, body: CurrencyPatch): Promise<Currency> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/currencies/${code}`,
    body,
    schema: CurrencySchema,
  });
}

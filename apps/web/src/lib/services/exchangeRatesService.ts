/**
 * Exchange rates service. Wraps the finance-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ExchangeRateSchema,
  type ExchangeRate,
  type ExchangeRateInsert,
} from '../types';

const ExchangeRateListSchema = z.object({
  items: z.array(ExchangeRateSchema),
  next_cursor: z.string().nullable(),
});

export interface ExchangeRateListFilters {
  base_code?: string;
  quote_code?: string;
  /** ISO date (YYYY-MM-DD), inclusive lower bound. */
  from?: string;
  /** ISO date (YYYY-MM-DD), inclusive upper bound. */
  to?: string;
  limit?: number;
}

function toQuery(filters: ExchangeRateListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.base_code) sp.set('base_code', filters.base_code);
  if (filters.quote_code) sp.set('quote_code', filters.quote_code);
  if (filters.from) sp.set('from', filters.from);
  if (filters.to) sp.set('to', filters.to);
  if (filters.limit) sp.set('limit', String(filters.limit));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listExchangeRates(filters?: ExchangeRateListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/exchange-rates${toQuery(filters)}`,
    schema: ExchangeRateListSchema,
  });
}

export function createExchangeRate(body: ExchangeRateInsert): Promise<ExchangeRate> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/exchange-rates',
    body,
    schema: ExchangeRateSchema,
  });
}

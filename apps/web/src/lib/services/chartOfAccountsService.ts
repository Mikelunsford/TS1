/**
 * Chart-of-accounts service (Wave 8 / Phase 12). Wraps finance-api's 5 COA
 * routes. Handlers refuse edit / archive on rows where `is_system=true`
 * (constitutional invariant — chassis-seeded accounts are immutable).
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ChartOfAccountSchema,
  type ChartOfAccount,
  type ChartOfAccountCreate,
  type ChartOfAccountPatch,
  type ChartOfAccountType,
} from '../types';

const ChartOfAccountListSchema = z.object({
  items: z.array(ChartOfAccountSchema),
  next_cursor: z.string().nullable().optional(),
});

export interface ChartOfAccountListFilters {
  account_type?: ChartOfAccountType;
  is_active?: boolean;
  parent_id?: string | null;
  q?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ChartOfAccountListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.account_type) sp.set('account_type', filters.account_type);
  if (filters.is_active !== undefined) sp.set('is_active', String(filters.is_active));
  if (filters.parent_id !== undefined && filters.parent_id !== null) {
    sp.set('parent_id', filters.parent_id);
  }
  if (filters.q) sp.set('q', filters.q);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listChartOfAccounts(filters?: ChartOfAccountListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/chart-of-accounts${toQuery(filters)}`,
    schema: ChartOfAccountListSchema,
  });
}

export function getChartOfAccount(id: string): Promise<ChartOfAccount> {
  return apiRequest({
    method: 'GET',
    path: `/finance-api/chart-of-accounts/${id}`,
    schema: ChartOfAccountSchema,
  });
}

export function createChartOfAccount(body: ChartOfAccountCreate): Promise<ChartOfAccount> {
  return apiRequest({
    method: 'POST',
    path: '/finance-api/chart-of-accounts',
    body,
    schema: ChartOfAccountSchema,
  });
}

export function updateChartOfAccount(
  id: string,
  body: ChartOfAccountPatch,
): Promise<ChartOfAccount> {
  return apiRequest({
    method: 'PATCH',
    path: `/finance-api/chart-of-accounts/${id}`,
    body,
    schema: ChartOfAccountSchema,
  });
}

export function archiveChartOfAccount(id: string): Promise<ChartOfAccount> {
  return apiRequest({
    method: 'POST',
    path: `/finance-api/chart-of-accounts/${id}/archive`,
    body: {},
    schema: ChartOfAccountSchema,
  });
}

/**
 * Production runs service (Wave 8f / Phase 13 SPA). Wraps the ops-api
 * /production-runs surface added in Wave 8d (PR #69). Bundle gated on
 * plugins.3pl on the BE.
 *
 * Workflow: scheduled → in_progress → completed (terminal); cancellable
 * from any non-terminal state. UNIQUE INDEX uniq_active_run_per_project
 * — at most one non-terminal run per project.
 *
 * See TS1/09-api/00-API-CONTRACT.md §13 + EDGE-FUNCTIONS-MAP §2.7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ProductionRunSchema,
  type ProductionRun,
  type ProductionRunCreate,
  type ProductionRunPatch,
} from '../types';

const ProductionRunListSchema = z.object({
  items: z.array(ProductionRunSchema),
  next_cursor: z.string().nullable(),
});

export interface ProductionRunListFilters {
  status?: string;
  project_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ProductionRunListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.project_id) sp.set('project_id', filters.project_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listProductionRuns(filters?: ProductionRunListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/production-runs${toQuery(filters)}`,
    schema: ProductionRunListSchema,
  });
}

export function getProductionRun(id: string): Promise<ProductionRun> {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/production-runs/${id}`,
    schema: ProductionRunSchema,
  });
}

export function createProductionRun(body: ProductionRunCreate): Promise<ProductionRun> {
  return apiRequest({
    method: 'POST',
    path: '/ops-api/production-runs',
    body,
    schema: ProductionRunSchema,
  });
}

export function updateProductionRun(
  id: string,
  body: ProductionRunPatch,
): Promise<ProductionRun> {
  return apiRequest({
    method: 'PATCH',
    path: `/ops-api/production-runs/${id}`,
    body,
    schema: ProductionRunSchema,
  });
}

export function startProductionRun(id: string): Promise<ProductionRun> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/production-runs/${id}/start`,
    body: {},
    schema: ProductionRunSchema,
  });
}

export function completeProductionRun(id: string): Promise<ProductionRun> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/production-runs/${id}/complete`,
    body: {},
    schema: ProductionRunSchema,
  });
}

export function cancelProductionRun(id: string): Promise<ProductionRun> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/production-runs/${id}/cancel`,
    body: {},
    schema: ProductionRunSchema,
  });
}

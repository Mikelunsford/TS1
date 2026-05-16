/**
 * Warehouses service (Wave 8f / Phase 13 SPA). Wraps the inventory-api
 * /warehouses surface added in Wave 8d (PR #69). Soft-archive flips
 * is_active=false via POST /:id/archive — refuses on the default warehouse.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  WarehouseSchema,
  type Warehouse,
  type WarehouseCreate,
  type WarehousePatch,
} from '../types';

const WarehouseListSchema = z.object({
  items: z.array(WarehouseSchema),
  next_cursor: z.string().nullable(),
});

export interface WarehouseListFilters {
  q?: string;
  is_active?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: WarehouseListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.is_active !== undefined) sp.set('is_active', String(filters.is_active));
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listWarehouses(filters?: WarehouseListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/warehouses${toQuery(filters)}`,
    schema: WarehouseListSchema,
  });
}

export function getWarehouse(id: string): Promise<Warehouse> {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/warehouses/${id}`,
    schema: WarehouseSchema,
  });
}

export function createWarehouse(body: WarehouseCreate): Promise<Warehouse> {
  return apiRequest({
    method: 'POST',
    path: '/inventory-api/warehouses',
    body,
    schema: WarehouseSchema,
  });
}

export function updateWarehouse(id: string, body: WarehousePatch): Promise<Warehouse> {
  return apiRequest({
    method: 'PATCH',
    path: `/inventory-api/warehouses/${id}`,
    body,
    schema: WarehouseSchema,
  });
}

export function archiveWarehouse(id: string): Promise<Warehouse> {
  return apiRequest({
    method: 'POST',
    path: `/inventory-api/warehouses/${id}/archive`,
    body: {},
    schema: WarehouseSchema,
  });
}

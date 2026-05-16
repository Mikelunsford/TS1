/**
 * Vendors service (Wave 7 / Phase 10). Wraps the vendors-api edge function
 * vendor routes in typed calls. See TS1/09-api/00-API-CONTRACT.md §10.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  VendorSchema,
  type Vendor,
  type VendorCreate,
  type VendorPatch,
} from '../types';

const VendorListSchema = z.object({
  items: z.array(VendorSchema),
  next_cursor: z.string().nullable(),
});

export interface VendorListFilters {
  q?: string;
  is_active?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: VendorListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.q) sp.set('q', filters.q);
  if (filters.is_active !== undefined) sp.set('is_active', String(filters.is_active));
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listVendors(filters?: VendorListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/vendors${toQuery(filters)}`,
    schema: VendorListSchema,
  });
}

export function getVendor(id: string): Promise<Vendor> {
  return apiRequest({
    method: 'GET',
    path: `/vendors-api/vendors/${id}`,
    schema: VendorSchema,
  });
}

export function createVendor(body: VendorCreate): Promise<Vendor> {
  return apiRequest({
    method: 'POST',
    path: '/vendors-api/vendors',
    body,
    schema: VendorSchema,
  });
}

export function updateVendor(id: string, body: VendorPatch): Promise<Vendor> {
  return apiRequest({
    method: 'PATCH',
    path: `/vendors-api/vendors/${id}`,
    body,
    schema: VendorSchema,
  });
}

export function archiveVendor(id: string): Promise<Vendor> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/vendors/${id}/archive`,
    body: {},
    schema: VendorSchema,
  });
}

/**
 * Leads service. Wraps the crm-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §3.3.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  LeadSchema,
  UuidSchema,
  type Lead,
  type LeadConvert,
  type LeadCreate,
  type LeadPatch,
} from '../types';

const LeadListSchema = z.object({
  items: z.array(LeadSchema),
  next_cursor: z.string().nullable(),
});

const ConvertResultSchema = z.object({
  lead: LeadSchema,
  customer_id: UuidSchema,
  opportunity_id: UuidSchema,
});

export interface LeadListFilters {
  status?: string;
  owner?: string;
  source?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: LeadListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.owner) sp.set('owner', filters.owner);
  if (filters.source) sp.set('source', filters.source);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listLeads(filters?: LeadListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/leads${toQuery(filters)}`,
    schema: LeadListSchema,
  });
}

export function getLead(id: string): Promise<Lead> {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/leads/${id}`,
    schema: LeadSchema,
  });
}

export function createLead(body: LeadCreate): Promise<Lead> {
  return apiRequest({
    method: 'POST',
    path: '/crm-api/leads',
    body,
    schema: LeadSchema,
  });
}

export function updateLead(id: string, body: LeadPatch): Promise<Lead> {
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/leads/${id}`,
    body,
    schema: LeadSchema,
  });
}

export function convertLead(id: string, body: LeadConvert) {
  return apiRequest({
    method: 'POST',
    path: `/crm-api/leads/${id}/convert`,
    body,
    schema: ConvertResultSchema,
  });
}

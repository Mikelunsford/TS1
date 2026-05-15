/**
 * Opportunities service. Wraps the crm-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §3.4.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  OpportunitySchema,
  type Opportunity,
  type OpportunityCreate,
  type OpportunityPatch,
  type OpportunityStageUpdate,
} from '../types';

const OpportunityListSchema = z.object({
  items: z.array(OpportunitySchema),
  next_cursor: z.string().nullable(),
});

export interface OpportunityListFilters {
  stage?: string;
  customer_id?: string;
  owner?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: OpportunityListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.stage) sp.set('stage', filters.stage);
  if (filters.customer_id) sp.set('customer_id', filters.customer_id);
  if (filters.owner) sp.set('owner', filters.owner);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listOpportunities(filters?: OpportunityListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/opportunities${toQuery(filters)}`,
    schema: OpportunityListSchema,
  });
}

export function getOpportunity(id: string): Promise<Opportunity> {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/opportunities/${id}`,
    schema: OpportunitySchema,
  });
}

export function createOpportunity(body: OpportunityCreate): Promise<Opportunity> {
  return apiRequest({
    method: 'POST',
    path: '/crm-api/opportunities',
    body,
    schema: OpportunitySchema,
  });
}

export function updateOpportunity(
  id: string,
  body: OpportunityPatch,
): Promise<Opportunity> {
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/opportunities/${id}`,
    body,
    schema: OpportunitySchema,
  });
}

export function updateOpportunityStage(
  id: string,
  body: OpportunityStageUpdate,
): Promise<Opportunity> {
  return apiRequest({
    method: 'PUT',
    path: `/crm-api/opportunities/${id}/stage`,
    body,
    schema: OpportunitySchema,
  });
}

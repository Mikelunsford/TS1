/**
 * Activities service. Wraps the crm-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §3.5.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ActivitySchema,
  type Activity,
  type ActivityCreate,
  type ActivityPatch,
} from '../types';

const ActivityListSchema = z.object({
  items: z.array(ActivitySchema),
  next_cursor: z.string().nullable(),
});

export interface ActivityListFilters {
  entity_type?: 'customer' | 'contact' | 'lead' | 'opportunity';
  entity_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ActivityListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.entity_type) sp.set('entity_type', filters.entity_type);
  if (filters.entity_id) sp.set('entity_id', filters.entity_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listActivities(filters?: ActivityListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/crm-api/activities${toQuery(filters)}`,
    schema: ActivityListSchema,
  });
}

export function createActivity(body: ActivityCreate): Promise<Activity> {
  return apiRequest({
    method: 'POST',
    path: '/crm-api/activities',
    body,
    schema: ActivitySchema,
  });
}

export function updateActivity(id: string, body: ActivityPatch): Promise<Activity> {
  return apiRequest({
    method: 'PATCH',
    path: `/crm-api/activities/${id}`,
    body,
    schema: ActivitySchema,
  });
}

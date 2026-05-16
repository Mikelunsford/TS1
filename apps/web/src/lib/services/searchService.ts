/**
 * Search service (Phase 17). Wraps the search-api edge function.
 *
 * Single endpoint:
 *   GET /search?q=<query>&types=customer,vendor,...&limit=20
 *
 * Returns up to `limit` results across the requested types.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';

export const SearchHitSchema = z.object({
  type: z.string(),
  id: z.string().uuid(),
  display_name: z.string(),
  snippet: z.string().nullable(),
  url_path: z.string(),
  org_id: z.string().uuid(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

export const SearchResultSchema = z.object({
  items: z.array(SearchHitSchema),
  q: z.string(),
  types: z.array(z.string()).optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export interface SearchFilters {
  q: string;
  types?: string[];
  limit?: number;
}

function toQuery(f: SearchFilters): string {
  const sp = new URLSearchParams();
  sp.set('q', f.q);
  if (f.types && f.types.length) sp.set('types', f.types.join(','));
  if (f.limit) sp.set('limit', String(f.limit));
  return `?${sp.toString()}`;
}

export function globalSearch(filters: SearchFilters): Promise<SearchResult> {
  return apiRequest({
    method: 'GET',
    path: `/search-api/search${toQuery(filters)}`,
    schema: SearchResultSchema,
  });
}

export const AuditRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  entity_type: z.string(),
  entity_id: z.string().uuid(),
  from_state: z.string().nullable(),
  to_state: z.string().nullable(),
  triggered_by: z.string().uuid().nullable(),
  triggered_at: z.string(),
  action: z.string().nullable(),
  diff_json: z.unknown().nullable(),
  notes: z.string().nullable(),
});
export type AuditRow = z.infer<typeof AuditRowSchema>;

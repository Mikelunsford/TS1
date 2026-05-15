/**
 * Opportunities query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md "Query
 * keys", shape is `[module, entity, ...args]`.
 */
import type { OpportunityListFilters } from '../services/opportunitiesService';

export const opportunityKeys = {
  all: ['crm', 'opportunities'] as const,
  list: (filters: OpportunityListFilters = {}) =>
    [...opportunityKeys.all, 'list', filters] as const,
  detail: (id: string) => [...opportunityKeys.all, 'detail', id] as const,
};

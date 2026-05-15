/**
 * Leads query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md "Query keys",
 * shape is `[module, entity, ...args]`.
 */
import type { LeadListFilters } from '../services/leadsService';

export const leadKeys = {
  all: ['crm', 'leads'] as const,
  list: (filters: LeadListFilters = {}) => [...leadKeys.all, 'list', filters] as const,
  detail: (id: string) => [...leadKeys.all, 'detail', id] as const,
};

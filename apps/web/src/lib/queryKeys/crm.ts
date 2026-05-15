/**
 * CRM-domain query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md "Query
 * keys", shape is `[module, entity, ...args]`. Construct keys via these
 * objects — never inline in components.
 */

export const customerKeys = {
  all: ['crm', 'customers'] as const,
  list: (filters: Record<string, unknown> = {}) => [...customerKeys.all, 'list', filters] as const,
  byId: (id: string) => [...customerKeys.all, 'byId', id] as const,
};

export const contactKeys = {
  all: ['crm', 'contacts'] as const,
  list: (filters: Record<string, unknown> = {}) => [...contactKeys.all, 'list', filters] as const,
  byId: (id: string) => [...contactKeys.all, 'byId', id] as const,
  byCustomer: (customerId: string) => [...contactKeys.all, 'byCustomer', customerId] as const,
};

export const leadKeys = {
  all: ['crm', 'leads'] as const,
  list: (filters: Record<string, unknown> = {}) => [...leadKeys.all, 'list', filters] as const,
  byId: (id: string) => [...leadKeys.all, 'byId', id] as const,
};

export const opportunityKeys = {
  all: ['crm', 'opportunities'] as const,
  list: (filters: Record<string, unknown> = {}) =>
    [...opportunityKeys.all, 'list', filters] as const,
  byId: (id: string) => [...opportunityKeys.all, 'byId', id] as const,
};

export const activityKeys = {
  all: ['crm', 'activities'] as const,
  list: (filters: Record<string, unknown> = {}) => [...activityKeys.all, 'list', filters] as const,
  byEntity: (entityType: string, entityId: string) =>
    [...activityKeys.all, 'byEntity', entityType, entityId] as const,
};

/**
 * Tenants/branding query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md
 * "Query keys", shape is `[module, entity, ...args]`.
 */
export const tenantsKeys = {
  all: ['tenants'] as const,
  branding: () => [...tenantsKeys.all, 'branding'] as const,
  resolveHost: (host: string) => [...tenantsKeys.all, 'resolve-host', host] as const,
};

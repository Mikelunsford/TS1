/**
 * Auth-domain query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md "Query
 * keys", shape is `[module, entity, ...args]`. Construct keys via this object
 * — never inline in components.
 */
export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
};

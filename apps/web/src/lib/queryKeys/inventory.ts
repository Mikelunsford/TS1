/**
 * Inventory-domain query keys. Per /03-workspace/01-NAMING-CONVENTIONS.md
 * "Query keys", shape is `[module, entity, ...args]`.
 *
 * Wave 3 / Phase 3 sales chassis: items, item categories, units.
 */

export const itemKeys = {
  all: ['inventory', 'items'] as const,
  list: () => [...itemKeys.all, 'list'] as const,
  detail: (id: string) => [...itemKeys.all, 'detail', id] as const,
};

export const itemCategoryKeys = {
  all: ['inventory', 'item-categories'] as const,
  list: () => [...itemCategoryKeys.all, 'list'] as const,
  detail: (id: string) => [...itemCategoryKeys.all, 'detail', id] as const,
};

export const unitKeys = {
  all: ['inventory', 'units'] as const,
  list: () => [...unitKeys.all, 'list'] as const,
  detail: (id: string) => [...unitKeys.all, 'detail', id] as const,
};

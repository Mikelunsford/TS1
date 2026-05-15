/**
 * Item categories service. Wraps the inventory-api edge function in typed calls.
 * The list endpoint returns a flat array; the SPA composes the tree.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ItemCategorySchema,
  type ItemCategory,
  type ItemCategoryCreate,
  type ItemCategoryPatch,
} from '../types';

const ItemCategoryListSchema = z.object({
  items: z.array(ItemCategorySchema),
  next_cursor: z.string().nullable(),
});

const DeleteResultSchema = z.object({ ok: z.literal(true) });

export function listItemCategories() {
  return apiRequest({
    method: 'GET',
    path: '/inventory-api/item-categories',
    schema: ItemCategoryListSchema,
  });
}

export function createItemCategory(body: ItemCategoryCreate): Promise<ItemCategory> {
  return apiRequest({
    method: 'POST',
    path: '/inventory-api/item-categories',
    body,
    schema: ItemCategorySchema,
  });
}

export function updateItemCategory(
  id: string,
  body: ItemCategoryPatch,
): Promise<ItemCategory> {
  return apiRequest({
    method: 'PATCH',
    path: `/inventory-api/item-categories/${id}`,
    body,
    schema: ItemCategorySchema,
  });
}

export function deleteItemCategory(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/inventory-api/item-categories/${id}`,
    body: {},
    schema: DeleteResultSchema,
  });
}

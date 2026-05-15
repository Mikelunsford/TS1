/**
 * Items service. Wraps the inventory-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { ItemSchema, type Item, type ItemCreate, type ItemPatch } from '../types';

const ItemListSchema = z.object({
  items: z.array(ItemSchema),
  next_cursor: z.string().nullable(),
});

export interface ItemListFilters {
  category_id?: string;
  q?: string;
  is_active?: boolean;
  is_inventoried?: boolean;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ItemListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.category_id) sp.set('category_id', filters.category_id);
  if (filters.q) sp.set('q', filters.q);
  if (filters.is_active !== undefined) sp.set('is_active', filters.is_active ? 'true' : 'false');
  if (filters.is_inventoried !== undefined)
    sp.set('is_inventoried', filters.is_inventoried ? 'true' : 'false');
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listItems(filters?: ItemListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/items${toQuery(filters)}`,
    schema: ItemListSchema,
  });
}

export function getItem(id: string): Promise<Item> {
  return apiRequest({
    method: 'GET',
    path: `/inventory-api/items/${id}`,
    schema: ItemSchema,
  });
}

export function createItem(body: ItemCreate): Promise<Item> {
  return apiRequest({
    method: 'POST',
    path: '/inventory-api/items',
    body,
    schema: ItemSchema,
  });
}

export function updateItem(id: string, body: ItemPatch): Promise<Item> {
  return apiRequest({
    method: 'PATCH',
    path: `/inventory-api/items/${id}`,
    body,
    schema: ItemSchema,
  });
}

export function archiveItem(id: string): Promise<Item> {
  return apiRequest({
    method: 'POST',
    path: `/inventory-api/items/${id}/archive`,
    body: {},
    schema: ItemSchema,
  });
}

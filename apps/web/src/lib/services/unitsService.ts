/**
 * Units service. Wraps the inventory-api edge function in typed calls.
 * See TS1/09-api/00-API-CONTRACT.md §9.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import { UnitSchema, type Unit, type UnitCreate, type UnitPatch } from '../types';

const UnitListSchema = z.object({
  items: z.array(UnitSchema),
  next_cursor: z.string().nullable(),
});

const DeleteResultSchema = z.object({ ok: z.literal(true) });

export function listUnits() {
  return apiRequest({
    method: 'GET',
    path: '/inventory-api/units',
    schema: UnitListSchema,
  });
}

export function createUnit(body: UnitCreate): Promise<Unit> {
  return apiRequest({
    method: 'POST',
    path: '/inventory-api/units',
    body,
    schema: UnitSchema,
  });
}

export function updateUnit(id: string, body: UnitPatch): Promise<Unit> {
  return apiRequest({
    method: 'PATCH',
    path: `/inventory-api/units/${id}`,
    body,
    schema: UnitSchema,
  });
}

export function deleteUnit(id: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/inventory-api/units/${id}`,
    body: {},
    schema: DeleteResultSchema,
  });
}

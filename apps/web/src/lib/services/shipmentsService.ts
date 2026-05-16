/**
 * Shipments service (Wave 8f / Phase 13 SPA). Wraps the ops-api
 * /shipments surface added in Wave 8d (PR #69). Bundle gated on
 * plugins.3pl on the BE.
 *
 * Workflow: scheduled → loading → shipped (terminal); cancellable
 * from scheduled/loading. UNIQUE INDEX uniq_active_shipment_per_project
 * — at most one non-terminal shipment per project. carrier_name NOT
 * NULL with btrim>0 — handler-enforced via Zod min(1).
 *
 * See TS1/09-api/00-API-CONTRACT.md §13 + EDGE-FUNCTIONS-MAP §2.7.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  ShipmentSchema,
  type Shipment,
  type ShipmentCancel,
  type ShipmentCreate,
  type ShipmentPatch,
} from '../types';

const ShipmentListSchema = z.object({
  items: z.array(ShipmentSchema),
  next_cursor: z.string().nullable(),
});

export interface ShipmentListFilters {
  status?: string;
  project_id?: string;
  limit?: number;
  cursor?: string;
}

function toQuery(filters: ShipmentListFilters | undefined): string {
  if (!filters) return '';
  const sp = new URLSearchParams();
  if (filters.status) sp.set('status', filters.status);
  if (filters.project_id) sp.set('project_id', filters.project_id);
  if (filters.limit) sp.set('limit', String(filters.limit));
  if (filters.cursor) sp.set('cursor', filters.cursor);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function listShipments(filters?: ShipmentListFilters) {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/shipments${toQuery(filters)}`,
    schema: ShipmentListSchema,
  });
}

export function getShipment(id: string): Promise<Shipment> {
  return apiRequest({
    method: 'GET',
    path: `/ops-api/shipments/${id}`,
    schema: ShipmentSchema,
  });
}

export function createShipment(body: ShipmentCreate): Promise<Shipment> {
  return apiRequest({
    method: 'POST',
    path: '/ops-api/shipments',
    body,
    schema: ShipmentSchema,
  });
}

export function updateShipment(id: string, body: ShipmentPatch): Promise<Shipment> {
  return apiRequest({
    method: 'PATCH',
    path: `/ops-api/shipments/${id}`,
    body,
    schema: ShipmentSchema,
  });
}

export function startLoadingShipment(id: string): Promise<Shipment> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/shipments/${id}/start-loading`,
    body: {},
    schema: ShipmentSchema,
  });
}

export function shipShipment(id: string): Promise<Shipment> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/shipments/${id}/ship`,
    body: {},
    schema: ShipmentSchema,
  });
}

export function cancelShipment(id: string, body?: ShipmentCancel): Promise<Shipment> {
  return apiRequest({
    method: 'POST',
    path: `/ops-api/shipments/${id}/cancel`,
    body: body ?? {},
    schema: ShipmentSchema,
  });
}

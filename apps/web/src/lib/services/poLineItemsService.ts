/**
 * Purchase order line items service (Wave 7 / Phase 10). The list of lines
 * is returned inline from `GET /purchase-orders/:id`, so this service only
 * exposes the granular append / patch / delete mutators.
 *
 * BE re-runs `recompute_purchase_order_totals` via trigger on AIUD, so
 * callers must invalidate both the PO detail key and the lines key after
 * any mutation.
 */

import { z } from 'zod';

import { apiRequest } from '../apiClient';
import {
  POLineItemSchema,
  type POLineItem,
  type POLineItemCreate,
  type POLineItemPatch,
} from '../types';

export function addPOLineItem(poId: string, body: POLineItemCreate): Promise<POLineItem> {
  return apiRequest({
    method: 'POST',
    path: `/vendors-api/purchase-orders/${poId}/lines`,
    body,
    schema: POLineItemSchema,
  });
}

export function patchPOLineItem(
  poId: string,
  lineId: string,
  body: POLineItemPatch,
): Promise<POLineItem> {
  return apiRequest({
    method: 'PATCH',
    path: `/vendors-api/purchase-orders/${poId}/lines/${lineId}`,
    body,
    schema: POLineItemSchema,
  });
}

export function deletePOLineItem(poId: string, lineId: string) {
  return apiRequest({
    method: 'DELETE',
    path: `/vendors-api/purchase-orders/${poId}/lines/${lineId}`,
    schema: z.object({ ok: z.literal(true) }),
  });
}

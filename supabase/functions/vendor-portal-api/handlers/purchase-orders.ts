/**
 * vendor-portal-api — /purchase-orders handlers (Phase 22).
 *
 * Read-only PO surface for the calling vendor + a single state-change
 * action: /acknowledge. Acknowledge is a side-channel signal ("vendor
 * has received and read the PO") and writes one audit_log row via
 * writeAudit(); it does NOT move the PO through the staff workflow
 * matrix (that's still the buyer's responsibility).
 *
 * `acknowledged_at` lives in the `notes` JSON-ish blob — there's no
 * dedicated column on prod (logged as a TODO; see PR body). Today the
 * audit row is the system of record.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError } from '../../_shared/responses.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseLimit,
  requireCap,
  resolveVendorCaller,
  respondWithIdempotency,
} from '../_helpers.ts';
import { writeAudit } from '../../_shared/audit.ts';

const BUNDLE = 'vendor-portal-api';
const PO_COLS =
  'id, org_id, po_number, vendor_id, project_id, status, issue_date, expected_date, ' +
  'currency_code, subtotal_cents, tax_cents, shipping_cents, total_cents, notes, ' +
  'state_changed_at, created_at, updated_at';
const LINE_COLS =
  'id, po_id, item_id, description, quantity, quantity_received, unit, ' +
  'unit_cost_cents, line_total_cents, position, created_at';

export async function listPOs({ req, url }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');

  let qb = admin()
    .from('purchase_orders')
    .select(PO_COLS)
    .eq('org_id', caller.orgId)
    .eq('vendor_id', caller.vendorId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (status) qb = qb.eq('status', status);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to list purchase orders', 500, {
      db: error.message,
    });
  }
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function getPO({ req, params }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const { data: po, error: poErr } = await admin()
    .from('purchase_orders')
    .select(PO_COLS)
    .eq('org_id', caller.orgId)
    .eq('vendor_id', caller.vendorId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (poErr) {
    throw new ApiError('INTERNAL_ERROR', 'failed to load purchase order', 500, {
      db: poErr.message,
    });
  }
  if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);

  const { data: lines, error: linesErr } = await admin()
    .from('po_line_items')
    .select(LINE_COLS)
    .eq('org_id', caller.orgId)
    .eq('po_id', po.id)
    .order('position', { ascending: true });
  if (linesErr) {
    throw new ApiError('INTERNAL_ERROR', 'failed to load po lines', 500, {
      db: linesErr.message,
    });
  }

  return ok({ ...po, lines: lines ?? [] }, undefined, { req });
}

export async function acknowledgePO({ req, params }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.write');

  return respondWithIdempotency(
    req,
    caller,
    BUNDLE,
    `POST /purchase-orders/${params.id}/acknowledge`,
    {},
    async () => {
      // Confirm row exists and belongs to caller before stamping audit.
      const { data: po, error } = await admin()
        .from('purchase_orders')
        .select('id, status')
        .eq('org_id', caller.orgId)
        .eq('vendor_id', caller.vendorId)
        .eq('id', params.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error) {
        throw new ApiError('INTERNAL_ERROR', 'failed to load purchase order', 500, {
          db: error.message,
        });
      }
      if (!po) throw new ApiError('NOT_FOUND', 'purchase order not found', 404);

      await writeAudit({
        actor_user_id: caller.userId,
        org_id: caller.orgId,
        entity_type: 'purchase_order',
        entity_id: po.id,
        action: 'vendor_acknowledged',
        from_state: po.status,
        to_state: po.status,
        notes: 'Vendor portal acknowledged receipt of purchase order',
        metadata: { vendor_id: caller.vendorId, channel: 'vendor-portal' },
      });

      return {
        status: 200,
        body: { data: { id: po.id, acknowledged_at: new Date().toISOString() } },
      };
    },
  );
}

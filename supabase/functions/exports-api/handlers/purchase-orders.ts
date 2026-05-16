/**
 * exports-api — /exports/purchase_orders CSV stream.
 *
 * Two shapes:
 *   default                         — one row per PO header
 *   ?expand=lines                   — one row per po_line_items row, with PO
 *                                      header fields denormalized onto each line
 *
 * Filters: ?status, ?vendor_id (header-level), ?start/?end (created_at).
 *
 * Gated on purchase_orders.read + procurement.enabled feature flag.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import { admin, requireCap } from '../../_shared/handler-helpers.ts';
import { requireFlag } from '../../_shared/requireFlag.ts';
import { makeExportHandler } from './_factory.ts';
import { streamCsvResponse } from '../../_shared/csv.ts';

interface PoRow {
  id: string;
  org_id: string;
  po_number: string;
  vendor_id: string;
  project_id: string | null;
  status: string;
  issue_date: string | null;
  expected_date: string | null;
  currency_code: string;
  subtotal_cents: number | string;
  tax_cents: number | string;
  shipping_cents: number | string;
  total_cents: number | string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PoLineRow {
  id: string;
  org_id: string;
  po_id: string;
  item_id: string | null;
  description: string | null;
  quantity: number | string;
  quantity_received: number | string;
  unit: string | null;
  unit_cost_cents: number | string;
  line_total_cents: number | string;
  position: number;
  created_at: string;
  updated_at: string;
}

const headerExport = makeExportHandler<PoRow>({
  slug: 'purchase_orders',
  table: 'purchase_orders',
  cols:
    'id, org_id, po_number, vendor_id, project_id, status, issue_date, expected_date, ' +
    'currency_code, subtotal_cents, tax_cents, shipping_cents, total_cents, notes, ' +
    'created_at, updated_at',
  headers: [
    'id',
    'po_number',
    'vendor_id',
    'project_id',
    'status',
    'issue_date',
    'expected_date',
    'currency_code',
    'subtotal_cents',
    'tax_cents',
    'shipping_cents',
    'total_cents',
    'notes',
    'created_at',
    'updated_at',
  ],
  toRow: (r) => [
    r.id,
    r.po_number,
    r.vendor_id,
    r.project_id,
    r.status,
    r.issue_date,
    r.expected_date,
    r.currency_code,
    r.subtotal_cents,
    r.tax_cents,
    r.shipping_cents,
    r.total_cents,
    r.notes,
    r.created_at,
    r.updated_at,
  ],
  cap: 'purchase_orders.read',
  flagKey: 'procurement.enabled',
  applyFilters: (qb, url) => {
    const status = url.searchParams.get('status');
    const vendorId = url.searchParams.get('vendor_id');
    if (status) qb = qb.eq('status', status);
    if (vendorId) qb = qb.eq('vendor_id', vendorId);
    return qb;
  },
});

const PAGE_SIZE = 500;

/** Lines-expanded shape: PO header columns + line columns, one row per line. */
async function exportPurchaseOrdersLines(ctx: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(ctx.req);
    requireCap(caller, 'purchase_orders.read');
    await requireFlag(admin(), caller.orgId, 'procurement.enabled');

    const start = ctx.url.searchParams.get('start');
    const end = ctx.url.searchParams.get('end');
    const today = new Date().toISOString().slice(0, 10);

    const headers = [
      'po_id',
      'po_number',
      'po_status',
      'po_vendor_id',
      'po_currency_code',
      'po_issue_date',
      'po_total_cents',
      'line_id',
      'line_position',
      'line_item_id',
      'line_description',
      'line_quantity',
      'line_quantity_received',
      'line_unit',
      'line_unit_cost_cents',
      'line_total_cents',
      'line_created_at',
    ];

    const fetchPage = async (
      cursor: { created_at: string; id: string } | null,
    ): Promise<{
      rows: Array<PoLineRow & { purchase_orders: PoRow | null }>;
      nextCursor: { created_at: string; id: string } | null;
    }> => {
      let qb = admin()
        .from('po_line_items')
        .select(
          'id, org_id, po_id, item_id, description, quantity, quantity_received, unit, ' +
            'unit_cost_cents, line_total_cents, position, created_at, updated_at, ' +
            'purchase_orders!inner(id, org_id, po_number, vendor_id, project_id, status, ' +
            'issue_date, expected_date, currency_code, subtotal_cents, tax_cents, shipping_cents, ' +
            'total_cents, notes, created_at, updated_at)',
        )
        .eq('org_id', caller.orgId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE + 1);

      if (start) qb = qb.gte('created_at', start);
      if (end) qb = qb.lte('created_at', end);
      if (cursor) {
        qb = qb.or(
          `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
        );
      }
      const { data, error } = await qb;
      if (error) {
        throw new ApiError(
          'INTERNAL_ERROR',
          'purchase_orders lines export query failed',
          500,
          { detail: error.message },
        );
      }
      const rows = (data ?? []) as unknown as Array<
        PoLineRow & { purchase_orders: PoRow | null }
      >;
      if (rows.length <= PAGE_SIZE) return { rows, nextCursor: null };
      const page = rows.slice(0, PAGE_SIZE);
      const overflow = rows[PAGE_SIZE];
      return {
        rows: page,
        nextCursor: { created_at: overflow.created_at, id: overflow.id },
      };
    };

    return streamCsvResponse(
      {
        headers,
        toRow: (r) => {
          const po = r.purchase_orders;
          return [
            po?.id ?? r.po_id,
            po?.po_number ?? '',
            po?.status ?? '',
            po?.vendor_id ?? '',
            po?.currency_code ?? '',
            po?.issue_date ?? '',
            po?.total_cents ?? '',
            r.id,
            r.position,
            r.item_id,
            r.description,
            r.quantity,
            r.quantity_received,
            r.unit,
            r.unit_cost_cents,
            r.line_total_cents,
            r.created_at,
          ];
        },
        fetchPage,
      },
      `purchase_orders-lines-${today}.csv`,
      {
        'x-org-id': caller.orgId,
        'x-request-id': ctx.req.headers.get('x-request-id') ?? crypto.randomUUID(),
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, ctx.req);
    throw e;
  }
}

export function exportPurchaseOrders(ctx: Ctx): Promise<Response> {
  const expand = ctx.url.searchParams.get('expand');
  if (expand === 'lines') return exportPurchaseOrdersLines(ctx);
  return headerExport(ctx) as Promise<Response>;
}

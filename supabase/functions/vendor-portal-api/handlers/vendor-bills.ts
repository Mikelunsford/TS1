/**
 * vendor-portal-api — /vendor-bills handlers (Phase 22).
 * Read-only view of the bills the vendor has issued, and payments
 * received (derived from vendor_bills.paid_cents > 0).
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
} from '../_helpers.ts';

const VB_COLS =
  'id, org_id, bill_number, vendor_id, po_id, vendor_ref, status, issue_date, due_date, ' +
  'currency_code, subtotal_cents, tax_cents, total_cents, paid_cents, balance_cents, ' +
  'notes, approved_at, paid_at, created_at, updated_at';

export async function listVendorBills({ req, url }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  const status = url.searchParams.get('status');

  let qb = admin()
    .from('vendor_bills')
    .select(VB_COLS)
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
    throw new ApiError('INTERNAL_ERROR', 'failed to list vendor bills', 500, {
      db: error.message,
    });
  }
  return ok(paginate(data ?? [], limit), undefined, { req });
}

export async function getVendorBill({ req, params }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const { data, error } = await admin()
    .from('vendor_bills')
    .select(VB_COLS)
    .eq('org_id', caller.orgId)
    .eq('vendor_id', caller.vendorId)
    .eq('id', params.id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to load vendor bill', 500, {
      db: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'vendor bill not found', 404);
  return ok(data, undefined, { req });
}

/**
 * GET /vendor-portal/payments — payments received from the org.
 * Derived from vendor_bills with paid_cents > 0 (no separate AP
 * payments table on prod today — vendor_bills carry paid_cents +
 * paid_at directly per the Wave 7 procurement schema).
 */
export async function listPayments({ req, url }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const limit = parseLimit(url);
  const cursor = decodeCursor(url.searchParams.get('cursor'));

  let qb = admin()
    .from('vendor_bills')
    .select(
      'id, bill_number, vendor_id, currency_code, paid_cents, paid_at, total_cents, created_at',
    )
    .eq('org_id', caller.orgId)
    .eq('vendor_id', caller.vendorId)
    .gt('paid_cents', 0)
    .is('deleted_at', null)
    .order('paid_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: false })
    .limit(limit + 1);
  if (cursor) {
    qb = qb.or(
      `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
    );
  }

  const { data, error } = await qb;
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to list payments', 500, {
      db: error.message,
    });
  }
  return ok(paginate(data ?? [], limit), undefined, { req });
}

/**
 * GET /vendor-portal/statements?as_of=YYYY-MM-DD
 * AP aging snapshot for THIS vendor — sums outstanding balance_cents
 * bucketed by due_date relative to as_of.
 */
export async function getStatement({ req, url }: Ctx): Promise<Response> {
  const caller = await resolveVendorCaller(req);
  requireCap(caller, 'vendor_portal.read');

  const asOf = url.searchParams.get('as_of') ?? new Date().toISOString().slice(0, 10);

  const { data, error } = await admin()
    .from('vendor_bills')
    .select(
      'id, bill_number, issue_date, due_date, currency_code, total_cents, paid_cents, balance_cents, status',
    )
    .eq('org_id', caller.orgId)
    .eq('vendor_id', caller.vendorId)
    .gt('balance_cents', 0)
    .is('deleted_at', null);
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'failed to load statement', 500, {
      db: error.message,
    });
  }

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const asOfDate = new Date(asOf + 'T00:00:00Z').getTime();
  type Row = {
    id: string;
    due_date: string | null;
    balance_cents: number | string;
  };
  for (const row of (data ?? []) as Row[]) {
    const bal = typeof row.balance_cents === 'string'
      ? Number.parseInt(row.balance_cents, 10)
      : row.balance_cents;
    if (!Number.isFinite(bal) || bal <= 0) continue;
    if (!row.due_date) {
      buckets.current += bal;
      continue;
    }
    const due = new Date(row.due_date + 'T00:00:00Z').getTime();
    const days = Math.floor((asOfDate - due) / (1000 * 60 * 60 * 24));
    if (days <= 0) buckets.current += bal;
    else if (days <= 30) buckets.d30 += bal;
    else if (days <= 60) buckets.d60 += bal;
    else if (days <= 90) buckets.d90 += bal;
    else buckets.d90plus += bal;
  }

  return ok(
    {
      as_of: asOf,
      vendor_id: caller.vendorId,
      buckets,
      total_outstanding_cents:
        buckets.current + buckets.d30 + buckets.d60 + buckets.d90 + buckets.d90plus,
      open_bills: data ?? [],
    },
    undefined,
    { req },
  );
}

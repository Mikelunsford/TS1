/**
 * customer-portal-api — GET /portal/payments
 *
 * Lists payments against the caller's customer_id (any invoice). Excludes
 * voided payments. Includes the related invoice_number for display.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  admin,
  paginate,
  parseLimit,
  decodeCursor,
  requireCap,
  resolvePortalCaller,
} from '../_helpers.ts';

const PAYMENT_COLS =
  'id, org_id, payment_number, customer_id, invoice_id, payment_method_id, ' +
  'paid_at, amount_cents, currency_code, reference, description, ' +
  'cleared_at, voided_at, created_at, updated_at';

export async function listPayments({ req, url }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    let query = admin()
      .from('payments')
      .select(PAYMENT_COLS)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .is('voided_at', null)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'payments list failed', 500, { detail: error.message });
    }
    const rows = (data ?? []) as Array<
      Record<string, unknown> & { id: string; created_at: string; invoice_id: string | null }
    >;
    const { items, next_cursor } = paginate(rows, limit);

    // Enrich with invoice_number for display. Single round-trip.
    const invoiceIds = Array.from(
      new Set(items.map((p) => p.invoice_id).filter((x): x is string => !!x)),
    );
    let invoiceNumberByCustomer: Record<string, string> = {};
    if (invoiceIds.length > 0) {
      const { data: invs } = await admin()
        .from('invoices')
        .select('id, invoice_number')
        .in('id', invoiceIds);
      invoiceNumberByCustomer = Object.fromEntries(
        ((invs ?? []) as Array<{ id: string; invoice_number: string }>).map((i) => [
          i.id,
          i.invoice_number,
        ]),
      );
    }

    return ok(
      {
        items: items.map((p) => ({
          ...p,
          invoice_number: p.invoice_id ? invoiceNumberByCustomer[p.invoice_id] ?? null : null,
        })),
        next_cursor,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

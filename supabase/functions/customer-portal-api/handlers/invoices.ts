/**
 * customer-portal-api — /portal/invoices handlers.
 *
 *   GET /portal/invoices?status=&page=&page_size=
 *   GET /portal/invoices/:id   (includes lines + signed pdf_url when present)
 *
 * Portal users only see invoices in a customer-facing state. Draft and
 * cancelled invoices are hidden by the explicit status filter; the
 * customer-scoped RLS in 0043 (`invoices_select_customer`) is the
 * primary boundary, and the explicit `.eq('customer_id', caller.customerId)`
 * is defense-in-depth.
 *
 * Cost fields (`unit_cost_cents`) are stripped from every line item
 * before serialization — portal users must never see internal costs.
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

const INVOICE_COLS =
  'id, org_id, invoice_number, customer_id, customer_name_snapshot, ' +
  'status, payment_status, currency_code, issue_date, due_date, ' +
  'subtotal_cents, discount_cents, tax_cents, total_cents, ' +
  'paid_cents, balance_cents, notes, sent_at, paid_at, ' +
  'pdf_path, created_at, updated_at';

// Portal-visible states. Draft and cancelled are intentionally hidden.
const VISIBLE_STATUSES = ['pending', 'sent', 'on_hold', 'paid', 'partially_paid', 'overdue'];

// Cost-sensitive line columns are NOT selected.
const LINE_COLS =
  'id, invoice_id, item_id, description, quantity, unit, ' +
  'unit_price_cents, discount_cents, tax_id, tax_rate_snapshot, ' +
  'tax_amount_cents, line_total_cents, position, created_at, updated_at';

const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

export async function listInvoices({ req, url }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');

    let query = admin()
      .from('invoices')
      .select(INVOICE_COLS)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .in('status', VISIBLE_STATUSES)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status && VISIBLE_STATUSES.includes(status)) {
      query = query.eq('status', status);
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      throw new ApiError('INTERNAL_ERROR', 'invoice list failed', 500, { detail: error.message });
    }
    const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; created_at: string }>;
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items, next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

export async function getInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const { data: invoice, error: iErr } = await admin()
      .from('invoices')
      .select(INVOICE_COLS)
      .eq('id', params.id)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .in('status', VISIBLE_STATUSES)
      .is('deleted_at', null)
      .maybeSingle();

    if (iErr) {
      throw new ApiError('INTERNAL_ERROR', 'invoice lookup failed', 500, { detail: iErr.message });
    }
    if (!invoice) throw new ApiError('NOT_FOUND', 'invoice not found', 404);

    const { data: lines, error: lErr } = await admin()
      .from('invoice_line_items')
      .select(LINE_COLS)
      .eq('invoice_id', params.id)
      .order('position', { ascending: true });

    if (lErr) {
      throw new ApiError('INTERNAL_ERROR', 'invoice lines lookup failed', 500, { detail: lErr.message });
    }

    let pdf_url: string | null = null;
    const pdfPath = (invoice as { pdf_path: string | null }).pdf_path;
    if (pdfPath) {
      const { data: signed } = await admin()
        .storage.from('pdfs')
        .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);
      pdf_url = signed?.signedUrl ?? null;
    }

    return ok(
      {
        invoice,
        lines: lines ?? [],
        pdf_url,
      },
      undefined,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

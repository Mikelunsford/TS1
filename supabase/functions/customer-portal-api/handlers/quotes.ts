/**
 * customer-portal-api — /portal/quotes handlers.
 *
 *   GET /portal/quotes?status=&page=&page_size=
 *   GET /portal/quotes/:id   (lines + signed pdf_url when present)
 *
 * Draft / declined / revising quotes are hidden — the portal user only
 * sees quotes they should act on or reference (sent, viewed, accepted,
 * converted). Cost fields stripped from lines.
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

const QUOTE_COLS =
  'id, org_id, quote_number, customer_id, customer_name, contact_name, ' +
  'contact_email, service_type, status, origin, mode, materials_only, ' +
  'requires_approval, project_id, currency_code, ' +
  'subtotal_cents, tax_cents, discount_cents, total_cents, ' +
  'notes, valid_until, state_changed_at, created_at, updated_at';

const VISIBLE_STATUSES = ['sent', 'viewed', 'accepted', 'converted', 'expired'];

// Cost-sensitive columns excluded.
const LINE_COLS =
  'id, quote_id, item_id, description, quantity, unit, ' +
  'unit_price_cents, discount_cents, tax_id, tax_rate_snapshot, ' +
  'tax_amount_cents, line_total_cents, position, created_at';

const SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;

export async function listQuotes({ req, url }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');

    let query = admin()
      .from('quotes')
      .select(QUOTE_COLS)
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
      throw new ApiError('INTERNAL_ERROR', 'quote list failed', 500, { detail: error.message });
    }
    const rows = (data ?? []) as Array<Record<string, unknown> & { id: string; created_at: string }>;
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items, next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

export async function getQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const base = requireCaller(req);
    requireCap(base, 'portal.read');
    const caller = await resolvePortalCaller(base);

    const { data: quote, error: qErr } = await admin()
      .from('quotes')
      .select(QUOTE_COLS + ', pdf_path')
      .eq('id', params.id)
      .eq('org_id', caller.orgId)
      .eq('customer_id', caller.customerId)
      .in('status', VISIBLE_STATUSES)
      .is('deleted_at', null)
      .maybeSingle();

    if (qErr) {
      // pdf_path may not exist on quotes table in early schemas; retry without it.
      if (/pdf_path/.test(qErr.message)) {
        const retry = await admin()
          .from('quotes')
          .select(QUOTE_COLS)
          .eq('id', params.id)
          .eq('org_id', caller.orgId)
          .eq('customer_id', caller.customerId)
          .in('status', VISIBLE_STATUSES)
          .is('deleted_at', null)
          .maybeSingle();
        if (retry.error) {
          throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, {
            detail: retry.error.message,
          });
        }
        if (!retry.data) throw new ApiError('NOT_FOUND', 'quote not found', 404);
        const lines = await admin()
          .from('quote_line_items')
          .select(LINE_COLS)
          .eq('quote_id', params.id)
          .order('position', { ascending: true });
        return ok({ quote: retry.data, lines: lines.data ?? [], pdf_url: null }, undefined, {
          req,
        });
      }
      throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, { detail: qErr.message });
    }
    if (!quote) throw new ApiError('NOT_FOUND', 'quote not found', 404);

    const { data: lines, error: lErr } = await admin()
      .from('quote_line_items')
      .select(LINE_COLS)
      .eq('quote_id', params.id)
      .order('position', { ascending: true });
    if (lErr) {
      throw new ApiError('INTERNAL_ERROR', 'quote lines lookup failed', 500, { detail: lErr.message });
    }

    let pdf_url: string | null = null;
    const pdfPath = (quote as { pdf_path?: string | null }).pdf_path ?? null;
    if (pdfPath) {
      const { data: signed } = await admin()
        .storage.from('pdfs')
        .createSignedUrl(pdfPath, SIGNED_URL_TTL_SECONDS);
      pdf_url = signed?.signedUrl ?? null;
    }

    return ok({ quote, lines: lines ?? [], pdf_url }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

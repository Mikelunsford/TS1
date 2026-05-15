/**
 * quotes-api — /quotes/:quote_id/line-items handlers.
 *
 * Per TS1/09-api/00-API-CONTRACT.md §4.2 + F-Wave4-13 (bypass the legacy
 * replace_quote_line_items RPC; do bulk DELETE+INSERT against the prod
 * columns). After any line mutation, recompute the parent quote's
 * subtotal_cents / tax_cents / total_cents via `taxTotalCents` and stamp
 * the header.
 *
 * Endpoints:
 *   GET    /quotes/:quote_id/line-items
 *   POST   /quotes/:quote_id/line-items                    — bulk replace
 *   POST   /quotes/:quote_id/line-items/append             — append single
 *   PATCH  /quotes/:quote_id/line-items/:line_id           — edit one
 *   DELETE /quotes/:quote_id/line-items/:line_id           — remove one
 *   POST   /quotes/:quote_id/line-items/reorder            — atomic reorder
 *
 * Parent-quote lock: every write rejects when parent quote.status !== 'draft'.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  QuoteLineReorderSchema,
  QuoteLineReplaceSchema,
  QuoteLineSchema,
  QuoteLineUpsertSchema,
  type QuoteLine,
  type QuoteLineUpsert,
} from '../../_shared/types.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';

const LINE_COLS =
  'id, org_id, quote_id, quote_version_id, item_id, description, quantity, unit, ' +
  'unit_price_cents, unit_cost_cents, discount_cents, tax_id, tax_rate_snapshot, ' +
  'tax_amount_cents, line_total_cents, position, created_at';

interface LineRow {
  id: string;
  org_id: string;
  quote_id: string;
  quote_version_id: string | null;
  item_id: string | null;
  description: string;
  quantity: number | string;
  unit: string | null;
  unit_price_cents: number;
  unit_cost_cents: number;
  discount_cents: number;
  tax_id: string | null;
  tax_rate_snapshot: number | string | null;
  tax_amount_cents: number;
  line_total_cents: number;
  position: number;
  created_at: string;
}

function rowToLine(row: LineRow): QuoteLine {
  return QuoteLineSchema.parse(row);
}

/**
 * Per-line totals computation. Mirrors `taxTotalCents` from
 * apps/web/src/lib/money.ts but operates on the row shape we persist:
 * line_total = round(qty * unit_price) - discount; tax_amount =
 * round(line_total * tax_rate).
 *
 * The SPA preview uses the SAME math via taxTotalCents (R-W3-06 close); the
 * money-parity contract test pins the fixture.
 */
function computeLineTotals(
  qty: number,
  unitPriceCents: number,
  discountCents: number,
  taxRate: number,
): { line_total_cents: number; tax_amount_cents: number } {
  const gross = Math.round(qty * unitPriceCents);
  const line_total_cents = gross - discountCents;
  const tax_amount_cents = Math.round(line_total_cents * taxRate);
  return { line_total_cents, tax_amount_cents };
}

async function fetchQuoteForLineWrite(caller: Caller, quoteId: string): Promise<{
  id: string;
  status: string;
  tax_id: string | null;
  tax_rate_snapshot: number | string | null;
}> {
  const { data, error } = await admin()
    .from('quotes')
    .select('id, status, tax_id, tax_rate_snapshot')
    .eq('id', quoteId)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'quote not found', 404);
  return data as {
    id: string;
    status: string;
    tax_id: string | null;
    tax_rate_snapshot: number | string | null;
  };
}

function assertEditableQuote(status: string): void {
  if (status !== 'draft') {
    throw new ApiError(
      'QUOTE_LINE_PARENT_LOCKED',
      `parent quote is ${status}; line items are read-only`,
      409,
    );
  }
}

async function resolveTaxRate(
  caller: Caller,
  taxId: string | null,
  fallback: number | string | null,
): Promise<number> {
  if (!taxId) return fallback === null ? 0 : Number(fallback);
  const { data, error } = await admin()
    .from('taxes')
    .select('rate')
    .eq('id', taxId)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'tax lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) {
    throw new ApiError('VALIDATION_ERROR', 'tax_id not found in caller org', 422);
  }
  return Number((data as { rate: number | string }).rate);
}

async function recomputeQuoteTotals(caller: Caller, quoteId: string): Promise<void> {
  const { data, error } = await admin()
    .from('quote_line_items')
    .select('line_total_cents, tax_amount_cents, discount_cents')
    .eq('quote_id', quoteId)
    .eq('org_id', caller.orgId);
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'line aggregation query failed', 500, {
      detail: error.message,
    });
  }
  const rows = (data ?? []) as Array<{
    line_total_cents: number | string;
    tax_amount_cents: number | string;
    discount_cents: number | string;
  }>;
  let subtotal = 0;
  let tax = 0;
  let discount = 0;
  for (const r of rows) {
    subtotal += Number(r.line_total_cents);
    tax += Number(r.tax_amount_cents);
    discount += Number(r.discount_cents);
  }
  const total = subtotal + tax;
  const { error: upErr } = await admin()
    .from('quotes')
    .update({
      subtotal_cents: subtotal,
      tax_cents: tax,
      discount_cents: discount,
      total_cents: total,
      updated_at: new Date().toISOString(),
    })
    .eq('id', quoteId)
    .eq('org_id', caller.orgId);
  if (upErr) {
    throw new ApiError('INTERNAL_ERROR', 'quote totals recompute failed', 500, {
      detail: upErr.message,
    });
  }
}

// =========================================================================
// GET /quotes/:quote_id/line-items
// =========================================================================
export async function listQuoteLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.read');
    // Verify quote belongs to org (RLS via service-role bypass — surface 404).
    const { data: quoteOk } = await admin()
      .from('quotes')
      .select('id')
      .eq('id', params.quote_id)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!quoteOk) {
      return err('NOT_FOUND', 'quote not found', undefined, 404, { req });
    }

    const { data, error } = await admin()
      .from('quote_line_items')
      .select(LINE_COLS)
      .eq('quote_id', params.quote_id)
      .eq('org_id', caller.orgId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) {
      return err('INTERNAL_ERROR', 'line list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const items = ((data ?? []) as LineRow[]).map(rowToLine);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /quotes/:quote_id/line-items   (bulk replace)
// =========================================================================
export async function replaceQuoteLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteLineReplaceSchema);
    const quoteId = params.quote_id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:quote_id/line-items',
      body,
      async () => {
        const parent = await fetchQuoteForLineWrite(caller, quoteId);
        assertEditableQuote(parent.status);

        // Delete every existing line for the quote.
        const { error: delErr } = await admin()
          .from('quote_line_items')
          .delete()
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId);
        if (delErr) {
          throw new ApiError('INTERNAL_ERROR', 'line clear failed', 500, {
            detail: delErr.message,
          });
        }

        // Build inserts with computed totals + per-line tax snapshot.
        const inserts: Array<Record<string, unknown>> = [];
        for (const line of body.lines) {
          const rate = await resolveTaxRate(caller, line.tax_id ?? null, null);
          const totals = computeLineTotals(
            line.quantity,
            line.unit_price_cents,
            line.discount_cents,
            rate,
          );
          inserts.push({
            org_id: caller.orgId,
            quote_id: quoteId,
            item_id: line.item_id ?? null,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit ?? null,
            unit_price_cents: line.unit_price_cents,
            unit_cost_cents: line.unit_cost_cents,
            discount_cents: line.discount_cents,
            tax_id: line.tax_id ?? null,
            tax_rate_snapshot: rate,
            position: line.position,
            ...totals,
          });
        }
        if (inserts.length > 0) {
          const { error: insErr } = await admin().from('quote_line_items').insert(inserts);
          if (insErr) {
            throw new ApiError('INTERNAL_ERROR', 'line bulk insert failed', 500, {
              detail: insErr.message,
            });
          }
        }

        await recomputeQuoteTotals(caller, quoteId);

        const { data: refreshed } = await admin()
          .from('quote_line_items')
          .select(LINE_COLS)
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId)
          .order('position', { ascending: true });
        const items = ((refreshed ?? []) as LineRow[]).map(rowToLine);
        return { status: 200, body: { data: { items, next_cursor: null } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /quotes/:quote_id/line-items/append   (single append)
// =========================================================================
export async function appendQuoteLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = (await parseBody(req, QuoteLineUpsertSchema)) as QuoteLineUpsert;
    const quoteId = params.quote_id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:quote_id/line-items/append',
      body,
      async () => {
        const parent = await fetchQuoteForLineWrite(caller, quoteId);
        assertEditableQuote(parent.status);
        const rate = await resolveTaxRate(caller, body.tax_id ?? null, null);
        const totals = computeLineTotals(
          body.quantity,
          body.unit_price_cents,
          body.discount_cents,
          rate,
        );
        const { data, error } = await admin()
          .from('quote_line_items')
          .insert({
            org_id: caller.orgId,
            quote_id: quoteId,
            item_id: body.item_id ?? null,
            description: body.description,
            quantity: body.quantity,
            unit: body.unit ?? null,
            unit_price_cents: body.unit_price_cents,
            unit_cost_cents: body.unit_cost_cents,
            discount_cents: body.discount_cents,
            tax_id: body.tax_id ?? null,
            tax_rate_snapshot: rate,
            position: body.position,
            ...totals,
          })
          .select(LINE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'line append failed', 500, {
            detail: error?.message,
          });
        }
        await recomputeQuoteTotals(caller, quoteId);
        return { status: 201, body: { data: rowToLine(data as LineRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /quotes/:quote_id/line-items/:line_id
// =========================================================================
export async function patchQuoteLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = (await parseBody(
      req,
      QuoteLineUpsertSchema.partial(),
    )) as Partial<QuoteLineUpsert>;
    const quoteId = params.quote_id;
    const lineId = params.line_id;

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /quotes/:quote_id/line-items/:line_id',
      body,
      async () => {
        const parent = await fetchQuoteForLineWrite(caller, quoteId);
        assertEditableQuote(parent.status);
        const { data: existing, error: exErr } = await admin()
          .from('quote_line_items')
          .select(LINE_COLS)
          .eq('id', lineId)
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (exErr) {
          throw new ApiError('INTERNAL_ERROR', 'line lookup failed', 500, {
            detail: exErr.message,
          });
        }
        if (!existing) throw new ApiError('NOT_FOUND', 'line not found', 404);
        const cur = existing as LineRow;
        const qty = body.quantity ?? Number(cur.quantity);
        const unitPrice = body.unit_price_cents ?? cur.unit_price_cents;
        const discount = body.discount_cents ?? cur.discount_cents;
        const taxId = body.tax_id === undefined ? cur.tax_id : body.tax_id ?? null;
        const rate = await resolveTaxRate(caller, taxId, cur.tax_rate_snapshot);
        const totals = computeLineTotals(qty, unitPrice, discount, rate);

        const patch: Record<string, unknown> = { ...totals, tax_rate_snapshot: rate };
        if (body.item_id !== undefined) patch.item_id = body.item_id;
        if (body.description !== undefined) patch.description = body.description;
        if (body.quantity !== undefined) patch.quantity = body.quantity;
        if (body.unit !== undefined) patch.unit = body.unit;
        if (body.unit_price_cents !== undefined) patch.unit_price_cents = body.unit_price_cents;
        if (body.unit_cost_cents !== undefined) patch.unit_cost_cents = body.unit_cost_cents;
        if (body.discount_cents !== undefined) patch.discount_cents = body.discount_cents;
        if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
        if (body.position !== undefined) patch.position = body.position;

        const { data, error } = await admin()
          .from('quote_line_items')
          .update(patch)
          .eq('id', lineId)
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId)
          .select(LINE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'line update failed', 500, {
            detail: error?.message,
          });
        }
        await recomputeQuoteTotals(caller, quoteId);
        return { status: 200, body: { data: rowToLine(data as LineRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// DELETE /quotes/:quote_id/line-items/:line_id
// =========================================================================
export async function deleteQuoteLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const quoteId = params.quote_id;
    const lineId = params.line_id;

    return await respondWithIdempotency(
      req,
      caller,
      'DELETE /quotes/:quote_id/line-items/:line_id',
      { lineId },
      async () => {
        const parent = await fetchQuoteForLineWrite(caller, quoteId);
        assertEditableQuote(parent.status);
        const { error, count } = await admin()
          .from('quote_line_items')
          .delete({ count: 'exact' })
          .eq('id', lineId)
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'line delete failed', 500, {
            detail: error.message,
          });
        }
        if (!count) throw new ApiError('NOT_FOUND', 'line not found', 404);
        await recomputeQuoteTotals(caller, quoteId);
        return { status: 200, body: { data: { ok: true } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /quotes/:quote_id/line-items/reorder
// =========================================================================
export async function reorderQuoteLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteLineReorderSchema);
    const quoteId = params.quote_id;

    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:quote_id/line-items/reorder',
      body,
      async () => {
        const parent = await fetchQuoteForLineWrite(caller, quoteId);
        assertEditableQuote(parent.status);
        // Step 1: shift each into the negative space so the new order can be
        // written without temporarily violating the (quote_id, position) unique
        // constraint (there isn't one today, but defensive anyway).
        for (let i = 0; i < body.line_ids.length; i++) {
          const { error } = await admin()
            .from('quote_line_items')
            .update({ position: -(i + 1) })
            .eq('id', body.line_ids[i])
            .eq('quote_id', quoteId)
            .eq('org_id', caller.orgId);
          if (error) {
            throw new ApiError('INTERNAL_ERROR', 'reorder shift failed', 500, {
              detail: error.message,
            });
          }
        }
        // Step 2: set the real positions.
        for (let i = 0; i < body.line_ids.length; i++) {
          const { error } = await admin()
            .from('quote_line_items')
            .update({ position: i })
            .eq('id', body.line_ids[i])
            .eq('quote_id', quoteId)
            .eq('org_id', caller.orgId);
          if (error) {
            throw new ApiError('INTERNAL_ERROR', 'reorder final failed', 500, {
              detail: error.message,
            });
          }
        }

        const { data } = await admin()
          .from('quote_line_items')
          .select(LINE_COLS)
          .eq('quote_id', quoteId)
          .eq('org_id', caller.orgId)
          .order('position', { ascending: true });
        const items = ((data ?? []) as LineRow[]).map(rowToLine);
        return { status: 200, body: { data: { items, next_cursor: null } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

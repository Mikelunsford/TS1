/**
 * invoicing-api — /invoices/:invoice_id/line-items handlers.
 *
 * Byte-modeled on quotes-api/handlers/line-items.ts. Differences:
 *   - parent column is `invoice_id` (not `quote_id`)
 *   - mirror column is `invoice_version_id` (not `quote_version_id`)
 *   - parent table has an `updated_at` column on `invoice_line_items`
 *     (quote_line_items does not); insert/update DON'T need to stamp it
 *     because the DB default + trigger handle it.
 *   - The DB recompute trigger on `invoice_line_items` (AIUD) rolls totals
 *     up to the parent invoice automatically — handlers do NOT call an
 *     equivalent of `recomputeQuoteTotals`. This matches the schema-master
 *     §9 contract and the migration 0050/0052 trigger surface.
 *
 * Parent-invoice lock: every write rejects when parent invoice.status !== 'draft'.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  InvoiceLineReorderSchema,
  InvoiceLineReplaceSchema,
  InvoiceLineSchema,
  InvoiceLineUpsertSchema,
  type InvoiceLine,
  type InvoiceLineUpsert,
} from '../../_shared/types.ts';
import {
  admin,
  parseBody,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';
import { roundHalfEven } from '../../_shared/money.ts';

const LINE_COLS =
  'id, org_id, invoice_id, invoice_version_id, item_id, description, quantity, unit, ' +
  'unit_price_cents, unit_cost_cents, discount_cents, tax_id, tax_rate_snapshot, ' +
  'tax_amount_cents, line_total_cents, position, created_at, updated_at';

interface LineRow {
  id: string;
  org_id: string;
  invoice_id: string;
  invoice_version_id: string | null;
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
  updated_at: string;
}

function rowToLine(row: LineRow): InvoiceLine {
  return InvoiceLineSchema.parse(row);
}

/**
 * Per-line totals computation — byte-mirrored from quotes-api/line-items.
 * line_total = qty * unit_price - discount;
 * tax_amount = roundHalfEven(line_total * tax_rate).
 */
function computeLineTotals(
  qty: number,
  unitPriceCents: number,
  discountCents: number,
  taxRate: number,
): { line_total_cents: number; tax_amount_cents: number } {
  const gross = roundHalfEven(qty * unitPriceCents);
  const line_total_cents = gross - discountCents;
  const tax_amount_cents = roundHalfEven(line_total_cents * taxRate);
  return { line_total_cents, tax_amount_cents };
}

async function fetchInvoiceForLineWrite(caller: Caller, invoiceId: string): Promise<{
  id: string;
  status: string;
  tax_id: string | null;
  tax_rate_snapshot: number | string | null;
}> {
  const { data, error } = await admin()
    .from('invoices')
    .select('id, status, tax_id, tax_rate_snapshot')
    .eq('id', invoiceId)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'invoice lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'invoice not found', 404);
  return data as {
    id: string;
    status: string;
    tax_id: string | null;
    tax_rate_snapshot: number | string | null;
  };
}

function assertEditableInvoice(status: string): void {
  if (status !== 'draft') {
    throw new ApiError(
      'INVOICE_LINE_PARENT_LOCKED',
      `parent invoice is ${status}; line items are read-only`,
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

// =========================================================================
// GET /invoices/:invoice_id/line-items
// =========================================================================
export async function listInvoiceLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.read');
    const { data: invoiceOk } = await admin()
      .from('invoices')
      .select('id')
      .eq('id', params.invoice_id)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .maybeSingle();
    if (!invoiceOk) {
      return err('NOT_FOUND', 'invoice not found', undefined, 404, { req });
    }

    const { data, error } = await admin()
      .from('invoice_line_items')
      .select(LINE_COLS)
      .eq('invoice_id', params.invoice_id)
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
// POST /invoices/:invoice_id/line-items   (bulk replace)
// =========================================================================
export async function replaceInvoiceLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceLineReplaceSchema);
    const invoiceId = params.invoice_id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:invoice_id/line-items',
      body,
      async () => {
        const parent = await fetchInvoiceForLineWrite(caller, invoiceId);
        assertEditableInvoice(parent.status);

        const { error: delErr } = await admin()
          .from('invoice_line_items')
          .delete()
          .eq('invoice_id', invoiceId)
          .eq('org_id', caller.orgId);
        if (delErr) {
          throw new ApiError('INTERNAL_ERROR', 'line clear failed', 500, {
            detail: delErr.message,
          });
        }

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
            invoice_id: invoiceId,
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
          const { error: insErr } = await admin()
            .from('invoice_line_items')
            .insert(inserts);
          if (insErr) {
            throw new ApiError('INTERNAL_ERROR', 'line bulk insert failed', 500, {
              detail: insErr.message,
            });
          }
        }

        const { data: refreshed } = await admin()
          .from('invoice_line_items')
          .select(LINE_COLS)
          .eq('invoice_id', invoiceId)
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
// POST /invoices/:invoice_id/line-items/append
// =========================================================================
export async function appendInvoiceLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = (await parseBody(req, InvoiceLineUpsertSchema)) as InvoiceLineUpsert;
    const invoiceId = params.invoice_id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:invoice_id/line-items/append',
      body,
      async () => {
        const parent = await fetchInvoiceForLineWrite(caller, invoiceId);
        assertEditableInvoice(parent.status);
        const rate = await resolveTaxRate(caller, body.tax_id ?? null, null);
        const totals = computeLineTotals(
          body.quantity,
          body.unit_price_cents,
          body.discount_cents,
          rate,
        );
        const { data, error } = await admin()
          .from('invoice_line_items')
          .insert({
            org_id: caller.orgId,
            invoice_id: invoiceId,
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
        return { status: 201, body: { data: rowToLine(data as LineRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /invoices/:invoice_id/line-items/:line_id
// =========================================================================
export async function patchInvoiceLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = (await parseBody(
      req,
      InvoiceLineUpsertSchema.partial(),
    )) as Partial<InvoiceLineUpsert>;
    const invoiceId = params.invoice_id;
    const lineId = params.line_id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'PATCH /invoices/:invoice_id/line-items/:line_id',
      body,
      async () => {
        const parent = await fetchInvoiceForLineWrite(caller, invoiceId);
        assertEditableInvoice(parent.status);
        const { data: existing, error: exErr } = await admin()
          .from('invoice_line_items')
          .select(LINE_COLS)
          .eq('id', lineId)
          .eq('invoice_id', invoiceId)
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
          .from('invoice_line_items')
          .update(patch)
          .eq('id', lineId)
          .eq('invoice_id', invoiceId)
          .eq('org_id', caller.orgId)
          .select(LINE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'line update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToLine(data as LineRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// DELETE /invoices/:invoice_id/line-items/:line_id
// =========================================================================
export async function deleteInvoiceLine({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const invoiceId = params.invoice_id;
    const lineId = params.line_id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'DELETE /invoices/:invoice_id/line-items/:line_id',
      { lineId },
      async () => {
        const parent = await fetchInvoiceForLineWrite(caller, invoiceId);
        assertEditableInvoice(parent.status);
        const { error, count } = await admin()
          .from('invoice_line_items')
          .delete({ count: 'exact' })
          .eq('id', lineId)
          .eq('invoice_id', invoiceId)
          .eq('org_id', caller.orgId);
        if (error) {
          throw new ApiError('INTERNAL_ERROR', 'line delete failed', 500, {
            detail: error.message,
          });
        }
        if (!count) throw new ApiError('NOT_FOUND', 'line not found', 404);
        return { status: 200, body: { data: { ok: true } } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /invoices/:invoice_id/line-items/reorder
// =========================================================================
export async function reorderInvoiceLines({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceLineReorderSchema);
    const invoiceId = params.invoice_id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:invoice_id/line-items/reorder',
      body,
      async () => {
        const parent = await fetchInvoiceForLineWrite(caller, invoiceId);
        assertEditableInvoice(parent.status);
        // Step 1: shift each into the negative space to avoid any
        // (invoice_id, position) unique-constraint collision during reorder.
        for (let i = 0; i < body.line_ids.length; i++) {
          const { error } = await admin()
            .from('invoice_line_items')
            .update({ position: -(i + 1) })
            .eq('id', body.line_ids[i])
            .eq('invoice_id', invoiceId)
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
            .from('invoice_line_items')
            .update({ position: i })
            .eq('id', body.line_ids[i])
            .eq('invoice_id', invoiceId)
            .eq('org_id', caller.orgId);
          if (error) {
            throw new ApiError('INTERNAL_ERROR', 'reorder final failed', 500, {
              detail: error.message,
            });
          }
        }

        const { data } = await admin()
          .from('invoice_line_items')
          .select(LINE_COLS)
          .eq('invoice_id', invoiceId)
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

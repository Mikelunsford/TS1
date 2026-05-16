/**
 * invoicing-api — /invoices handlers (Wave 5 / Phase 7).
 *
 * Endpoints per TS1/09-api/00-API-CONTRACT.md §6, reconciled DB-wins to the
 * prod `invoices` shape + `invoices.status` text CHECK (verified 2026-05-15,
 * schema_migrations=0052):
 *
 *   GET    /invoices                          — list (filters: q, status,
 *                                                payment_status, customer_id,
 *                                                currency_code, from, to)
 *   POST   /invoices                          — create draft
 *   GET    /invoices/:id                      — detail (header only)
 *   PATCH  /invoices/:id                      — edit draft (rejected if not draft)
 *   POST   /invoices/:id/submit               — draft → pending
 *   POST   /invoices/:id/send                 — pending|on_hold|sent → sent;
 *                                              stamps sent_at on first transition
 *   POST   /invoices/:id/void                 — * (non-terminal) → cancelled;
 *                                              stamps cancelled_at + reason
 *   POST   /invoices/:id/hold                 — pending|sent → on_hold;
 *                                              stamps on_hold_at
 *   POST   /invoices/:id/release              — on_hold → pending; clears on_hold_at
 *   POST   /invoices/:id/duplicate            — clone as draft (new number)
 *   GET    /invoices/:id/pdf                  — 501 PDF_NOT_YET_AVAILABLE
 *   GET    /invoices/:id/versions             — list mirror rows
 *   POST   /invoices/from-quote               — convert_quote_to_invoice RPC
 *   POST   /invoices/from-project             — convert_project_to_invoice RPC
 *
 * Drifts from API-contract §6 (DB-wins reconcile; docs reconcile in 5.4):
 *   - `customer_name_snapshot` (not `customer_name`)
 *   - single `notes` (no `notes_customer` / `terms`)
 *   - no `tax_inclusive` column; per-line `discount_cents` only
 *   - `recurring` enum on the invoice row (no separate config table)
 *   - cancellation lives at `cancelled_at` + `cancellation_reason`; "void"
 *     in the contract maps to status='cancelled' on the DB
 *   - audit_log rows are written by the `trg_invoices_audit_state` trigger
 *     (handlers MUST NOT insert audit_log rows manually)
 *   - The recompute trigger keeps `balance_cents` / `total_cents` /
 *     `subtotal_cents` / `tax_cents` in sync from line items + payments.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  InvoiceConvertFromProjectSchema,
  InvoiceConvertFromQuoteSchema,
  InvoiceCreateSchema,
  InvoiceDuplicateSchema,
  InvoiceHoldSchema,
  InvoicePatchSchema,
  InvoiceReleaseSchema,
  InvoiceSchema,
  InvoiceSendSchema,
  InvoiceSubmitSchema,
  InvoiceVersionSchema,
  InvoiceVoidSchema,
  type Invoice,
  type InvoiceVersion,
} from '../../_shared/types.ts';
import { assertTransition, WorkflowError } from '../../_shared/workflow.ts';
import {
  admin,
  decodeCursor,
  paginate,
  parseBody,
  parseLimit,
  requireCap,
  respondWithIdempotency,
  type Caller,
} from '../../_shared/handler-helpers.ts';

const INVOICE_COLS =
  'id, org_id, invoice_number, customer_id, customer_name_snapshot, project_id, quote_id, ' +
  'status, payment_status, recurring, content, notes, issue_date, due_date, state_changed_at, ' +
  'approved, is_overdue, converted_from_type, converted_from_id, currency_code, exchange_rate, ' +
  'subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, balance_cents, ' +
  'tax_id, tax_rate_snapshot, pdf_path, external_ref, sent_at, paid_at, cancelled_at, ' +
  'cancellation_reason, pending_at, on_hold_at, created_at, updated_at';

const INVOICE_VERSION_COLS =
  'id, org_id, invoice_id, version_number, status, payment_status, issue_date, due_date, ' +
  'notes, currency_code, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, created_at';

interface InvoiceRow {
  id: string;
  org_id: string;
  invoice_number: string;
  customer_id: string;
  customer_name_snapshot: string;
  project_id: string | null;
  quote_id: string | null;
  status: string;
  payment_status: string;
  recurring: string | null;
  content: string | null;
  notes: string | null;
  issue_date: string;
  due_date: string;
  state_changed_at: string;
  approved: boolean;
  is_overdue: boolean;
  converted_from_type: string | null;
  converted_from_id: string | null;
  currency_code: string;
  exchange_rate: number | string | null;
  subtotal_cents: number;
  discount_cents: number;
  tax_cents: number;
  total_cents: number;
  paid_cents: number;
  balance_cents: number | null;
  tax_id: string | null;
  tax_rate_snapshot: number | string | null;
  pdf_path: string | null;
  external_ref: string | null;
  sent_at: string | null;
  paid_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  pending_at: string | null;
  on_hold_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInvoice(row: InvoiceRow): Invoice {
  return InvoiceSchema.parse(row);
}

function rowToInvoiceVersion(row: Record<string, unknown>): InvoiceVersion {
  return InvoiceVersionSchema.parse(row);
}

// =========================================================================
// Helpers
// =========================================================================

async function fetchInvoiceRow(caller: Caller, id: string): Promise<InvoiceRow> {
  const { data, error } = await admin()
    .from('invoices')
    .select(INVOICE_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'invoice lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'invoice not found', 404);
  return data as InvoiceRow;
}

async function nextInvoiceNumber(orgId: string): Promise<string> {
  const { data, error } = await admin().rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: 'invoice',
  });
  if (error || typeof data !== 'string') {
    throw new ApiError('INTERNAL_ERROR', 'next_doc_number invoice failed', 500, {
      detail: error?.message,
    });
  }
  return data;
}

async function ensureCustomerInOrg(caller: Caller, customerId: string): Promise<string> {
  const { data, error } = await admin()
    .from('customers')
    .select('id, display_name')
    .eq('id', customerId)
    .eq('org_id', caller.orgId)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'customer lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) {
    throw new ApiError('VALIDATION_ERROR', 'customer_id not found in caller org', 422);
  }
  return (data as { display_name: string }).display_name;
}

function workflowToApiError(e: unknown): never {
  if (e instanceof WorkflowError) {
    throw new ApiError('STATE_CONFLICT', e.message, 409, {
      machine: e.machine,
      from: e.from,
      to: e.to,
    });
  }
  throw e;
}

// =========================================================================
// GET /invoices
// =========================================================================
export async function listInvoices({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const paymentStatus = url.searchParams.get('payment_status');
    const customerId = url.searchParams.get('customer_id');
    const currency = url.searchParams.get('currency_code');
    const q = url.searchParams.get('q');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

    let query = admin()
      .from('invoices')
      .select(INVOICE_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (paymentStatus) query = query.eq('payment_status', paymentStatus);
    if (customerId) query = query.eq('customer_id', customerId);
    if (currency) query = query.eq('currency_code', currency);
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate);
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      query = query.or(
        `invoice_number.ilike.${like},customer_name_snapshot.ilike.${like}`,
      );
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'invoice list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as InvoiceRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToInvoice), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /invoices/:id
// =========================================================================
export async function getInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.read');
    const row = await fetchInvoiceRow(caller, params.id);
    return ok(rowToInvoice(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /invoices
// =========================================================================
export async function createInvoice({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices',
      body,
      async () => {
        const customerName =
          body.customer_name_snapshot?.trim() ||
          (await ensureCustomerInOrg(caller, body.customer_id));
        if (!customerName) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'customer_name_snapshot is required (customer has no display_name)',
            422,
          );
        }
        const invoiceNumber = await nextInvoiceNumber(caller.orgId);
        const issue = body.issue_date ?? new Date().toISOString().slice(0, 10);

        const { data, error } = await admin()
          .from('invoices')
          .insert({
            org_id: caller.orgId,
            invoice_number: invoiceNumber,
            customer_id: body.customer_id,
            customer_name_snapshot: customerName,
            project_id: body.project_id ?? null,
            quote_id: body.quote_id ?? null,
            status: 'draft',
            payment_status: 'unpaid',
            recurring: body.recurring ?? null,
            content: body.content ?? null,
            notes: body.notes ?? null,
            issue_date: issue,
            due_date: body.due_date,
            currency_code: body.currency_code,
            exchange_rate: body.exchange_rate ?? null,
            tax_id: body.tax_id ?? null,
            tax_rate_snapshot: body.tax_rate_snapshot ?? null,
            external_ref: body.external_ref ?? null,
            created_by: caller.userId,
          })
          .select(INVOICE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'invoice insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToInvoice(data as InvoiceRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /invoices/:id
// =========================================================================
export async function patchInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoicePatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'PATCH /invoices/:id',
      body,
      async () => {
        const existing = await fetchInvoiceRow(caller, id);
        if (existing.status !== 'draft') {
          throw new ApiError(
            'INVOICE_LOCKED',
            `invoice is ${existing.status}; only drafts are editable`,
            409,
          );
        }

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
        if (body.customer_name_snapshot !== undefined)
          patch.customer_name_snapshot = body.customer_name_snapshot;
        if (body.project_id !== undefined) patch.project_id = body.project_id;
        if (body.quote_id !== undefined) patch.quote_id = body.quote_id;
        if (body.notes !== undefined) patch.notes = body.notes;
        if (body.content !== undefined) patch.content = body.content;
        if (body.recurring !== undefined) patch.recurring = body.recurring;
        if (body.issue_date !== undefined) patch.issue_date = body.issue_date;
        if (body.due_date !== undefined) patch.due_date = body.due_date;
        if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
        if (body.exchange_rate !== undefined) patch.exchange_rate = body.exchange_rate;
        if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
        if (body.tax_rate_snapshot !== undefined)
          patch.tax_rate_snapshot = body.tax_rate_snapshot;
        if (body.external_ref !== undefined) patch.external_ref = body.external_ref;

        const { data, error } = await admin()
          .from('invoices')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(INVOICE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'invoice update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToInvoice(data as InvoiceRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// Workflow transitions
// =========================================================================

async function transitionInvoice(
  caller: Caller,
  id: string,
  to: string,
  routeLabel: string,
  stampers?: (patch: Record<string, unknown>, row: InvoiceRow) => void,
): Promise<{ status: number; body: { data: Invoice } }> {
  const existing = await fetchInvoiceRow(caller, id);
  try {
    assertTransition('invoice', existing.status, to);
  } catch (e) {
    workflowToApiError(e);
  }
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: to,
    state_changed_at: nowIso,
    updated_at: nowIso,
  };
  if (stampers) stampers(patch, existing);

  const { data, error } = await admin()
    .from('invoices')
    .update(patch)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .select(INVOICE_COLS)
    .single();
  if (error || !data) {
    throw new ApiError('INTERNAL_ERROR', `invoice ${routeLabel} failed`, 500, {
      detail: error?.message,
    });
  }
  return { status: 200, body: { data: rowToInvoice(data as InvoiceRow) } };
}

// POST /invoices/:id/submit  (draft -> pending)
export async function submitInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceSubmitSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/submit',
      body,
      async () =>
        transitionInvoice(caller, params.id, 'pending', 'submit', (patch) => {
          patch.pending_at = new Date().toISOString();
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /invoices/:id/send  (pending|on_hold|sent -> sent; stamps sent_at)
export async function sendInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.send');
    const body = await parseBody(req, InvoiceSendSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/send',
      body,
      async () =>
        transitionInvoice(caller, params.id, 'sent', 'send', (patch, row) => {
          if (!row.sent_at) patch.sent_at = new Date().toISOString();
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /invoices/:id/void  (any non-terminal -> cancelled)
export async function voidInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.void');
    const body = await parseBody(req, InvoiceVoidSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/void',
      body,
      async () =>
        transitionInvoice(caller, params.id, 'cancelled', 'void', (patch) => {
          patch.cancelled_at = new Date().toISOString();
          patch.cancellation_reason = body.reason;
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /invoices/:id/hold  (pending|sent -> on_hold)
export async function holdInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceHoldSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/hold',
      body,
      async () =>
        transitionInvoice(caller, params.id, 'on_hold', 'hold', (patch) => {
          patch.on_hold_at = new Date().toISOString();
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /invoices/:id/release  (on_hold -> pending; clears on_hold_at)
export async function releaseInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceReleaseSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/release',
      body,
      async () =>
        transitionInvoice(caller, params.id, 'pending', 'release', (patch) => {
          patch.on_hold_at = null;
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /invoices/:id/duplicate
export async function duplicateInvoice({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceDuplicateSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/:id/duplicate',
      body,
      async () => {
        const source = await fetchInvoiceRow(caller, params.id);
        const invoiceNumber = await nextInvoiceNumber(caller.orgId);
        const { data, error } = await admin()
          .from('invoices')
          .insert({
            org_id: caller.orgId,
            invoice_number: invoiceNumber,
            customer_id: source.customer_id,
            customer_name_snapshot: source.customer_name_snapshot,
            project_id: source.project_id,
            quote_id: source.quote_id,
            status: 'draft',
            payment_status: 'unpaid',
            recurring: source.recurring,
            content: source.content,
            notes: source.notes,
            issue_date: new Date().toISOString().slice(0, 10),
            due_date: source.due_date,
            currency_code: source.currency_code,
            exchange_rate: source.exchange_rate,
            tax_id: source.tax_id,
            tax_rate_snapshot: source.tax_rate_snapshot,
            external_ref: source.external_ref,
            created_by: caller.userId,
          })
          .select(INVOICE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'invoice duplicate failed', 500, {
            detail: error?.message,
          });
        }
        const newId = (data as InvoiceRow).id;

        // Clone lines (the recompute trigger handles header rollup).
        const { data: sourceLines } = await admin()
          .from('invoice_line_items')
          .select(
            'item_id, description, quantity, unit, unit_price_cents, unit_cost_cents, ' +
              'discount_cents, tax_id, tax_rate_snapshot, position',
          )
          .eq('invoice_id', source.id)
          .eq('org_id', caller.orgId);
        const lines = (sourceLines ?? []) as Array<Record<string, unknown>>;
        if (lines.length > 0) {
          const insertLines = lines.map((l) => ({
            ...l,
            org_id: caller.orgId,
            invoice_id: newId,
          }));
          const { error: linesErr } = await admin()
            .from('invoice_line_items')
            .insert(insertLines);
          if (linesErr) {
            throw new ApiError('INTERNAL_ERROR', 'invoice duplicate lines failed', 500, {
              detail: linesErr.message,
            });
          }
        }
        return { status: 201, body: { data: rowToInvoice(data as InvoiceRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /invoices/:id/pdf — 501 (Phase 19)
// =========================================================================
export async function getInvoicePdf({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.read');
    return err(
      'PDF_NOT_YET_AVAILABLE',
      'PDF generation lands in Phase 19; this endpoint is reserved.',
      undefined,
      501,
      { req },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /invoices/:id/versions
// =========================================================================
export async function listInvoiceVersions({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.read');
    await fetchInvoiceRow(caller, params.id);

    const { data, error } = await admin()
      .from('invoice_versions')
      .select(INVOICE_VERSION_COLS)
      .eq('invoice_id', params.id)
      .eq('org_id', caller.orgId)
      .order('version_number', { ascending: false });
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'invoice version list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const items = ((data ?? []) as Record<string, unknown>[]).map(rowToInvoiceVersion);
    return ok({ items }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /invoices/from-quote
// =========================================================================
export async function convertFromQuote({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceConvertFromQuoteSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/from-quote',
      body,
      async () => {
        // Verify quote belongs to caller's org (RPC is SECURITY DEFINER; we
        // pre-check for a clean 404 vs 500 RPC failure).
        const { data: quoteRow, error: quoteErr } = await admin()
          .from('quotes')
          .select('id, org_id, status')
          .eq('id', body.quote_id)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null)
          .maybeSingle();
        if (quoteErr) {
          throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, {
            detail: quoteErr.message,
          });
        }
        if (!quoteRow) throw new ApiError('NOT_FOUND', 'quote not found', 404);

        const { data: rpcData, error: rpcErr } = await admin().rpc(
          'convert_quote_to_invoice',
          {
            p_quote_id: body.quote_id,
            p_due_date: body.due_date,
          },
        );
        if (rpcErr) {
          throw new ApiError('INTERNAL_ERROR', 'convert_quote_to_invoice rpc failed', 500, {
            detail: rpcErr.message,
          });
        }
        const invoiceId =
          typeof rpcData === 'string'
            ? rpcData
            : (rpcData as { id?: string } | null)?.id ?? null;
        if (!invoiceId) {
          throw new ApiError('INTERNAL_ERROR', 'convert rpc returned no invoice id', 500);
        }
        const { data: invoice, error: invErr } = await admin()
          .from('invoices')
          .select(INVOICE_COLS)
          .eq('id', invoiceId)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (invErr || !invoice) {
          throw new ApiError('INTERNAL_ERROR', 'invoice lookup after convert failed', 500, {
            detail: invErr?.message,
          });
        }
        return {
          status: 201,
          body: { data: rowToInvoice(invoice as InvoiceRow) },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /invoices/from-project
// =========================================================================
export async function convertFromProject({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'invoices.write');
    const body = await parseBody(req, InvoiceConvertFromProjectSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /invoices/from-project',
      body,
      async () => {
        const { data: projRow, error: projErr } = await admin()
          .from('projects')
          .select('id, org_id, status')
          .eq('id', body.project_id)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null)
          .maybeSingle();
        if (projErr) {
          throw new ApiError('INTERNAL_ERROR', 'project lookup failed', 500, {
            detail: projErr.message,
          });
        }
        if (!projRow) throw new ApiError('NOT_FOUND', 'project not found', 404);

        const { data: rpcData, error: rpcErr } = await admin().rpc(
          'convert_project_to_invoice',
          {
            p_project_id: body.project_id,
            p_due_date: body.due_date,
          },
        );
        if (rpcErr) {
          throw new ApiError('INTERNAL_ERROR', 'convert_project_to_invoice rpc failed', 500, {
            detail: rpcErr.message,
          });
        }
        const invoiceId =
          typeof rpcData === 'string'
            ? rpcData
            : (rpcData as { id?: string } | null)?.id ?? null;
        if (!invoiceId) {
          throw new ApiError('INTERNAL_ERROR', 'convert rpc returned no invoice id', 500);
        }
        const { data: invoice, error: invErr } = await admin()
          .from('invoices')
          .select(INVOICE_COLS)
          .eq('id', invoiceId)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (invErr || !invoice) {
          throw new ApiError('INTERNAL_ERROR', 'invoice lookup after convert failed', 500, {
            detail: invErr?.message,
          });
        }
        return {
          status: 201,
          body: { data: rowToInvoice(invoice as InvoiceRow) },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

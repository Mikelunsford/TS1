/**
 * quotes-api — /quotes handlers (Wave 4 / Phase 4).
 *
 * Endpoints per TS1/09-api/00-API-CONTRACT.md §4.1 + Wave 4 dispatch §4.2b,
 * reconciled to the prod `quotes` shape + `quote_state` enum (verified
 * 2026-05-15, schema_migrations=0050):
 *
 *   GET    /quotes                          — list (filters: q, status,
 *                                              customer_id, currency_code,
 *                                              from, to)
 *   POST   /quotes                          — create draft (requires service_type)
 *   GET    /quotes/:id                      — detail (header + lines + versions)
 *   PATCH  /quotes/:id                      — edit draft (rejected if not draft)
 *   POST   /quotes/:id/submit               — draft → submitted; auto-stamps
 *                                              requires_approval if total above
 *                                              org approval threshold
 *   POST   /quotes/:id/approve              — submitted → approved (cap
 *                                              quotes.approve)
 *   POST   /quotes/:id/request-revisions    — submitted → revise_requested
 *   POST   /quotes/:id/decline              — submitted|approved → cancelled
 *   POST   /quotes/:id/convert-to-project   — approved → project_pending via
 *                                              convert_quote_to_project RPC
 *   POST   /quotes/:id/duplicate            — clone draft (new quote_number)
 *   POST   /quotes/:id/send                 — NO state change; activity row
 *   POST   /quotes/:id/accept               — NO state change; activity row
 *   GET    /quotes/:id/pdf                  — 501 PDF_NOT_YET_AVAILABLE
 *   GET    /quotes/:id/versions             — list mirror rows
 *
 * Drifts from the dispatch text (reconciled per R-W4-PF-01):
 *   - `tax_inclusive`, `discount_pct`, `terms`, `notes_internal`,
 *     `notes_customer`, `contact_id` columns DO NOT exist on prod. Only
 *     `notes` (single), `contact_name`, `contact_email`, `discount_cents`
 *     (cents not percent).
 *   - `sent_at` / `accepted_at` columns DO NOT exist. /send and /accept
 *     emit `activities` rows only (entity_type='quote', kind='note').
 *   - `customer_name` is denormalized NOT NULL — stamped at create.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  QuoteAcceptSchema,
  QuoteApproveSchema,
  QuoteConvertSchema,
  QuoteCreateSchema,
  QuoteDeclineSchema,
  QuoteDuplicateSchema,
  QuotePatchSchema,
  QuoteRequestRevisionsSchema,
  QuoteSchema,
  QuoteSendSchema,
  QuoteSubmitSchema,
  QuoteVersionSchema,
  type Quote,
  type QuoteVersion,
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
import { getNextDocNumber, NumberingError } from '../../_shared/numbering.ts';

const QUOTE_COLS =
  'id, org_id, quote_number, customer_id, customer_name, contact_name, contact_email, ' +
  'service_type, status, origin, mode, materials_only, requires_approval, ' +
  'job_type_id, opportunity_id, project_id, currency_code, exchange_rate, ' +
  'tax_id, tax_rate_snapshot, subtotal_cents, tax_cents, discount_cents, total_cents, ' +
  'notes, valid_until, state_changed_at, created_at, updated_at';

const QUOTE_VERSION_COLS =
  'id, org_id, quote_id, version_number, status, service_type, mode, ' +
  'materials_only, requires_approval, job_type_id, opportunity_id, ' +
  'currency_code, exchange_rate, tax_id, tax_rate_snapshot, ' +
  'subtotal_cents, tax_cents, discount_cents, total_cents, notes, valid_until, created_at';

// Mirrored from projects-api/handlers/projects.ts to keep the convert-to-project
// response shape stable without a cross-bundle import (Edge Function bundles do
// not share a Deno module graph at deploy time).
const PROJECT_COLS_FOR_CONVERT =
  'id, org_id, project_number, quote_id, customer_id, customer_name, name, status, ' +
  'currency_code, total_cents, budget_cents, due_date, invoice_id, ' +
  'bom_finalized_at, bom_finalized_by, ready_to_build_at, sent_to_production_at, ' +
  'production_started_at, production_completed_at, ready_to_ship_at, ' +
  'shipping_completed_at, created_at, updated_at';

interface QuoteRow {
  id: string;
  org_id: string;
  quote_number: string;
  customer_id: string;
  customer_name: string;
  contact_name: string | null;
  contact_email: string | null;
  service_type: string;
  status: string;
  origin: string;
  mode: string;
  materials_only: boolean;
  requires_approval: boolean;
  job_type_id: string | null;
  opportunity_id: string | null;
  project_id: string | null;
  currency_code: string;
  exchange_rate: number | string | null;
  tax_id: string | null;
  tax_rate_snapshot: number | string | null;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  notes: string | null;
  valid_until: string | null;
  state_changed_at: string;
  created_at: string;
  updated_at: string;
}

function rowToQuote(row: QuoteRow): Quote {
  return QuoteSchema.parse(row);
}

function rowToQuoteVersion(row: Record<string, unknown>): QuoteVersion {
  return QuoteVersionSchema.parse(row);
}

// =========================================================================
// Helpers
// =========================================================================

async function fetchQuoteRow(caller: Caller, id: string): Promise<QuoteRow> {
  const { data, error } = await admin()
    .from('quotes')
    .select(QUOTE_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'quote lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'quote not found', 404);
  return data as QuoteRow;
}

async function nextQuoteNumber(orgId: string): Promise<string> {
  try {
    return await getNextDocNumber(admin(), orgId, 'quote');
  } catch (e) {
    if (e instanceof NumberingError) {
      throw new ApiError('INTERNAL_ERROR', 'next_doc_number quote failed', 500, {
        detail: e.message,
      });
    }
    throw e;
  }
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

async function logQuoteActivity(
  caller: Caller,
  quoteId: string,
  kind: 'note',
  subject: string,
  body: string | null,
): Promise<void> {
  const { error } = await admin().from('activities').insert({
    org_id: caller.orgId,
    entity_type: 'quote',
    entity_id: quoteId,
    kind,
    subject,
    body,
    status: 'completed',
    completed_at: new Date().toISOString(),
    created_by: caller.userId,
  });
  if (error) {
    // Activities log is best-effort. Surface as 500 only if it indicates a real
    // schema mismatch; otherwise let the caller see success on the main op.
    throw new ApiError('INTERNAL_ERROR', 'activity write failed', 500, {
      detail: error.message,
    });
  }
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
// GET /quotes
// =========================================================================
export async function listQuotes({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const status = url.searchParams.get('status');
    const customerId = url.searchParams.get('customer_id');
    const currency = url.searchParams.get('currency_code');
    const q = url.searchParams.get('q');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

    let query = admin()
      .from('quotes')
      .select(QUOTE_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (status) query = query.eq('status', status);
    if (customerId) query = query.eq('customer_id', customerId);
    if (currency) query = query.eq('currency_code', currency);
    if (fromDate) query = query.gte('created_at', fromDate);
    if (toDate) query = query.lte('created_at', toDate);
    if (q) {
      const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
      query = query.or(`quote_number.ilike.${like},customer_name.ilike.${like}`);
    }
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'quote list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as QuoteRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToQuote), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /quotes/:id
// =========================================================================
export async function getQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.read');
    const row = await fetchQuoteRow(caller, params.id);
    return ok(rowToQuote(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /quotes
// =========================================================================
export async function createQuote({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteCreateSchema);

    return await respondWithIdempotency(req, caller, 'POST /quotes', body, async () => {
      // Validate customer in caller's org and snapshot the customer display name.
      const customerName =
        body.customer_name?.trim() || (await ensureCustomerInOrg(caller, body.customer_id));
      if (!customerName) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'customer_name is required (customer has no display_name)',
          422,
        );
      }

      const quoteNumber = await nextQuoteNumber(caller.orgId);
      const { data, error } = await admin()
        .from('quotes')
        .insert({
          org_id: caller.orgId,
          quote_number: quoteNumber,
          customer_id: body.customer_id,
          customer_name: customerName,
          contact_name: body.contact_name ?? null,
          contact_email: body.contact_email ?? null,
          service_type: body.service_type,
          status: 'draft',
          origin: body.origin,
          mode: body.mode,
          materials_only: body.materials_only,
          job_type_id: body.job_type_id ?? null,
          opportunity_id: body.opportunity_id ?? null,
          currency_code: body.currency_code ?? 'USD',
          tax_id: body.tax_id ?? null,
          notes: body.notes ?? null,
          valid_until: body.valid_until ?? null,
          created_by: caller.userId,
        })
        .select(QUOTE_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'quote insert failed', 500, {
          detail: error?.message,
        });
      }
      return { status: 201, body: { data: rowToQuote(data as QuoteRow) } };
    });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /quotes/:id
// =========================================================================
export async function patchQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuotePatchSchema);
    const id = params.id;

    return await respondWithIdempotency(req, caller, 'PATCH /quotes/:id', body, async () => {
      const existing = await fetchQuoteRow(caller, id);
      if (existing.status !== 'draft') {
        throw new ApiError(
          'QUOTE_LOCKED_VERSION',
          `quote is ${existing.status}; only drafts are editable`,
          409,
        );
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (body.customer_id !== undefined) patch.customer_id = body.customer_id;
      if (body.customer_name !== undefined) patch.customer_name = body.customer_name;
      if (body.contact_name !== undefined) patch.contact_name = body.contact_name;
      if (body.contact_email !== undefined) patch.contact_email = body.contact_email;
      if (body.service_type !== undefined) patch.service_type = body.service_type;
      if (body.origin !== undefined) patch.origin = body.origin;
      if (body.mode !== undefined) patch.mode = body.mode;
      if (body.materials_only !== undefined) patch.materials_only = body.materials_only;
      if (body.job_type_id !== undefined) patch.job_type_id = body.job_type_id;
      if (body.opportunity_id !== undefined) patch.opportunity_id = body.opportunity_id;
      if (body.currency_code !== undefined) patch.currency_code = body.currency_code;
      if (body.tax_id !== undefined) patch.tax_id = body.tax_id;
      if (body.notes !== undefined) patch.notes = body.notes;
      if (body.valid_until !== undefined) patch.valid_until = body.valid_until;

      const { data, error } = await admin()
        .from('quotes')
        .update(patch)
        .eq('id', id)
        .eq('org_id', caller.orgId)
        .select(QUOTE_COLS)
        .single();
      if (error || !data) {
        throw new ApiError('INTERNAL_ERROR', 'quote update failed', 500, {
          detail: error?.message,
        });
      }
      return { status: 200, body: { data: rowToQuote(data as QuoteRow) } };
    });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// Workflow transitions
// =========================================================================

const APPROVAL_THRESHOLD_CENTS = 2_500_000; // Phase-15 deferred constant; F-Wave4-X
                                              // tracks moving this to org_settings.

async function transitionQuote(
  caller: Caller,
  id: string,
  to: string,
  routeLabel: string,
  body: unknown,
  stampers?: (patch: Record<string, unknown>, row: QuoteRow) => void,
): Promise<{ status: number; body: { data: Quote } }> {
  return await (async () => {
    const existing = await fetchQuoteRow(caller, id);
    try {
      assertTransition('quote', existing.status, to);
    } catch (e) {
      workflowToApiError(e);
    }
    const patch: Record<string, unknown> = {
      status: to,
      state_changed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (stampers) stampers(patch, existing);

    const { data, error } = await admin()
      .from('quotes')
      .update(patch)
      .eq('id', id)
      .eq('org_id', caller.orgId)
      .select(QUOTE_COLS)
      .single();
    if (error || !data) {
      throw new ApiError('INTERNAL_ERROR', `quote ${routeLabel} failed`, 500, {
        detail: error?.message,
      });
    }
    return { status: 200, body: { data: rowToQuote(data as QuoteRow) } };
  })();
}

// POST /quotes/:id/submit
export async function submitQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteSubmitSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/submit',
      body,
      async () =>
        transitionQuote(caller, params.id, 'submitted', 'submit', body, (patch, row) => {
          if (row.total_cents >= APPROVAL_THRESHOLD_CENTS) {
            patch.requires_approval = true;
          }
        }),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/approve
export async function approveQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.approve');
    const body = await parseBody(req, QuoteApproveSchema);
    return await respondWithIdempotency(req, caller, 'POST /quotes/:id/approve', body, () =>
      transitionQuote(caller, params.id, 'approved', 'approve', body),
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/request-revisions
export async function requestRevisionsQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteRequestRevisionsSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/request-revisions',
      body,
      async () => {
        const result = await transitionQuote(
          caller,
          params.id,
          'revise_requested',
          'request-revisions',
          body,
        );
        await logQuoteActivity(
          caller,
          params.id,
          'note',
          'Revisions requested',
          body.reason,
        );
        return result;
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/decline
export async function declineQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteDeclineSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/decline',
      body,
      async () => {
        const result = await transitionQuote(caller, params.id, 'cancelled', 'decline', body);
        await logQuoteActivity(caller, params.id, 'note', 'Quote declined', body.reason);
        return result;
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/convert-to-project
export async function convertQuoteToProject({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.convert');
    const body = await parseBody(req, QuoteConvertSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/convert-to-project',
      body,
      async () => {
        // Verify quote exists in caller's org + is in approved state.
        const existing = await fetchQuoteRow(caller, params.id);
        try {
          assertTransition('quote', existing.status, 'project_pending');
        } catch (e) {
          workflowToApiError(e);
        }

        const { data: rpcData, error: rpcErr } = await admin().rpc(
          'convert_quote_to_project',
          {
            p_quote_id: params.id,
            p_project_name: body.project_name,
            p_due_date: body.due_date ?? null,
          },
        );
        if (rpcErr) {
          throw new ApiError('INTERNAL_ERROR', 'convert_quote_to_project rpc failed', 500, {
            detail: rpcErr.message,
          });
        }
        // RPC returns the new project_id (uuid) — fetch the row to envelope.
        const projectId =
          typeof rpcData === 'string'
            ? rpcData
            : (rpcData as { id?: string } | null)?.id ?? null;
        if (!projectId) {
          throw new ApiError('INTERNAL_ERROR', 'convert rpc returned no project id', 500);
        }
        const { data: project, error: projErr } = await admin()
          .from('projects')
          .select(PROJECT_COLS_FOR_CONVERT)
          .eq('id', projectId)
          .eq('org_id', caller.orgId)
          .maybeSingle();
        if (projErr || !project) {
          throw new ApiError('INTERNAL_ERROR', 'project lookup after convert failed', 500, {
            detail: projErr?.message,
          });
        }
        return {
          status: 201,
          body: { data: { quote_id: params.id, project } },
        };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/duplicate
export async function duplicateQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteDuplicateSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/duplicate',
      body,
      async () => {
        const source = await fetchQuoteRow(caller, params.id);
        const quoteNumber = await nextQuoteNumber(caller.orgId);
        const { data, error } = await admin()
          .from('quotes')
          .insert({
            org_id: caller.orgId,
            quote_number: quoteNumber,
            customer_id: source.customer_id,
            customer_name: source.customer_name,
            contact_name: source.contact_name,
            contact_email: source.contact_email,
            service_type: source.service_type,
            status: 'draft',
            origin: source.origin,
            mode: source.mode,
            materials_only: source.materials_only,
            job_type_id: source.job_type_id,
            opportunity_id: source.opportunity_id,
            currency_code: source.currency_code,
            tax_id: source.tax_id,
            notes: source.notes,
            valid_until: source.valid_until,
            created_by: caller.userId,
          })
          .select(QUOTE_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'quote duplicate failed', 500, {
            detail: error?.message,
          });
        }
        const newId = (data as QuoteRow).id;

        // Clone lines (without tax_amount_cents / line_total_cents — those are
        // recomputed when the user submits or when a line write touches the
        // parent recompute).
        const { data: sourceLines } = await admin()
          .from('quote_line_items')
          .select(
            'item_id, description, quantity, unit, unit_price_cents, unit_cost_cents, ' +
              'discount_cents, tax_id, position',
          )
          .eq('quote_id', source.id)
          .eq('org_id', caller.orgId);
        const lines = (sourceLines ?? []) as Array<Record<string, unknown>>;
        if (lines.length > 0) {
          const insertLines = lines.map((l) => ({
            ...l,
            org_id: caller.orgId,
            quote_id: newId,
          }));
          const { error: linesErr } = await admin().from('quote_line_items').insert(insertLines);
          if (linesErr) {
            throw new ApiError('INTERNAL_ERROR', 'quote duplicate lines failed', 500, {
              detail: linesErr.message,
            });
          }
        }
        return { status: 201, body: { data: rowToQuote(data as QuoteRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/send
export async function sendQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.send');
    const body = await parseBody(req, QuoteSendSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/send',
      body,
      async () => {
        const row = await fetchQuoteRow(caller, params.id);
        // No state change. Activity row + optional email (Phase 19).
        await logQuoteActivity(
          caller,
          params.id,
          'note',
          `Quote sent to ${body.to_email ?? row.contact_email ?? 'customer'}`,
          body.message ?? null,
        );
        return { status: 200, body: { data: rowToQuote(row) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// POST /quotes/:id/accept
export async function acceptQuote({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.write');
    const body = await parseBody(req, QuoteAcceptSchema);
    return await respondWithIdempotency(
      req,
      caller,
      'POST /quotes/:id/accept',
      body,
      async () => {
        const row = await fetchQuoteRow(caller, params.id);
        await logQuoteActivity(
          caller,
          params.id,
          'note',
          'Customer accepted the quote',
          body.note ?? null,
        );
        return { status: 200, body: { data: rowToQuote(row) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /quotes/:id/pdf — 501 NOT_IMPLEMENTED (Phase 19)
// =========================================================================
export async function getQuotePdf({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.read');
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
// GET /quotes/:id/versions
// =========================================================================
export async function listQuoteVersions({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'quotes.read');
    // Surfaces NOT_FOUND if the quote does not belong to caller's org.
    await fetchQuoteRow(caller, params.id);

    const { data, error } = await admin()
      .from('quote_versions')
      .select(QUOTE_VERSION_COLS)
      .eq('quote_id', params.id)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('version_number', { ascending: false });
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'version list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const items = ((data ?? []) as Record<string, unknown>[]).map(rowToQuoteVersion);
    return ok({ items }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

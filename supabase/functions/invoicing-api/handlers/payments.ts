/**
 * invoicing-api — /payments handlers (Wave 5 / Phase 8).
 *
 * Endpoints:
 *   GET    /payments                — list (filters: customer_id, invoice_id,
 *                                      from, to, currency_code)
 *   POST   /payments                — record payment
 *   GET    /payments/:id            — detail
 *   PATCH  /payments/:id            — edit non-voided payment
 *   POST   /payments/:id/void       — set voided_at + void_reason
 *
 * The recompute trigger on `payments` (added in 0052) handles invoice
 * rollup automatically — handlers do NOT touch `invoices.paid_cents` or
 * `invoices.balance_cents`. The 0052 BEFORE INSERT trigger
 * `assert_invoice_payment_currency` enforces currency parity with the
 * parent invoice, surfacing as a 500/INTERNAL_ERROR on violation; clients
 * should pass the invoice's currency_code on the wire.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PaymentCreateSchema,
  PaymentPatchSchema,
  PaymentSchema,
  PaymentVoidSchema,
  type Payment,
} from '../../_shared/types.ts';
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

const PAYMENT_COLS =
  'id, org_id, payment_number, customer_id, invoice_id, payment_method_id, paid_at, ' +
  'amount_cents, currency_code, exchange_rate, reference, description, external_ref, ' +
  'cleared_at, voided_at, void_reason, created_at, updated_at';

interface PaymentRow {
  id: string;
  org_id: string;
  payment_number: string;
  customer_id: string;
  invoice_id: string;
  payment_method_id: string | null;
  paid_at: string;
  amount_cents: number;
  currency_code: string;
  exchange_rate: number | string | null;
  reference: string | null;
  description: string | null;
  external_ref: string | null;
  cleared_at: string | null;
  voided_at: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPayment(row: PaymentRow): Payment {
  return PaymentSchema.parse(row);
}

async function fetchPaymentRow(caller: Caller, id: string): Promise<PaymentRow> {
  const { data, error } = await admin()
    .from('payments')
    .select(PAYMENT_COLS)
    .eq('id', id)
    .eq('org_id', caller.orgId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) {
    throw new ApiError('INTERNAL_ERROR', 'payment lookup failed', 500, {
      detail: error.message,
    });
  }
  if (!data) throw new ApiError('NOT_FOUND', 'payment not found', 404);
  return data as PaymentRow;
}

async function nextPaymentNumber(orgId: string): Promise<string> {
  const { data, error } = await admin().rpc('next_doc_number', {
    p_org_id: orgId,
    p_doc_type: 'payment',
  });
  if (error || typeof data !== 'string') {
    throw new ApiError('INTERNAL_ERROR', 'next_doc_number payment failed', 500, {
      detail: error?.message,
    });
  }
  return data;
}

// =========================================================================
// GET /payments
// =========================================================================
export async function listPayments({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.read');
    const limit = parseLimit(url);
    const cursor = decodeCursor(url.searchParams.get('cursor'));
    const customerId = url.searchParams.get('customer_id');
    const invoiceId = url.searchParams.get('invoice_id');
    const currency = url.searchParams.get('currency_code');
    const fromDate = url.searchParams.get('from');
    const toDate = url.searchParams.get('to');

    let query = admin()
      .from('payments')
      .select(PAYMENT_COLS)
      .eq('org_id', caller.orgId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit + 1);

    if (customerId) query = query.eq('customer_id', customerId);
    if (invoiceId) query = query.eq('invoice_id', invoiceId);
    if (currency) query = query.eq('currency_code', currency);
    if (fromDate) query = query.gte('paid_at', fromDate);
    if (toDate) query = query.lte('paid_at', toDate);
    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`,
      );
    }

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'payment list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const rows = (data ?? []) as PaymentRow[];
    const { items, next_cursor } = paginate(rows, limit);
    return ok({ items: items.map(rowToPayment), next_cursor }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// GET /payments/:id
// =========================================================================
export async function getPayment({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.read');
    const row = await fetchPaymentRow(caller, params.id);
    return ok(rowToPayment(row), undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /payments
// =========================================================================
export async function createPayment({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.write');
    const body = await parseBody(req, PaymentCreateSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /payments',
      body,
      async () => {
        // Verify invoice belongs to caller's org (and its currency matches —
        // the BEFORE trigger will also enforce, but a clean 422 is friendlier).
        const { data: invoice, error: invErr } = await admin()
          .from('invoices')
          .select('id, currency_code, status')
          .eq('id', body.invoice_id)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null)
          .maybeSingle();
        if (invErr) {
          throw new ApiError('INTERNAL_ERROR', 'invoice lookup failed', 500, {
            detail: invErr.message,
          });
        }
        if (!invoice) {
          throw new ApiError('VALIDATION_ERROR', 'invoice_id not found in caller org', 422);
        }
        const inv = invoice as { currency_code: string; status: string };
        if (inv.currency_code !== body.currency_code) {
          throw new ApiError(
            'VALIDATION_ERROR',
            `payment currency_code ${body.currency_code} does not match invoice ${inv.currency_code}`,
            422,
          );
        }
        if (inv.status === 'draft' || inv.status === 'cancelled') {
          throw new ApiError(
            'STATE_CONFLICT',
            `cannot record payment against invoice in ${inv.status} state`,
            409,
          );
        }

        const paymentNumber = await nextPaymentNumber(caller.orgId);
        const { data, error } = await admin()
          .from('payments')
          .insert({
            org_id: caller.orgId,
            payment_number: paymentNumber,
            customer_id: body.customer_id,
            invoice_id: body.invoice_id,
            payment_method_id: body.payment_method_id ?? null,
            paid_at: body.paid_at ?? new Date().toISOString(),
            amount_cents: body.amount_cents,
            currency_code: body.currency_code,
            exchange_rate: body.exchange_rate ?? null,
            reference: body.reference ?? null,
            description: body.description ?? null,
            external_ref: body.external_ref ?? null,
            created_by: caller.userId,
          })
          .select(PAYMENT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'payment insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToPayment(data as PaymentRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// PATCH /payments/:id
// =========================================================================
export async function patchPayment({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.write');
    const body = await parseBody(req, PaymentPatchSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'PATCH /payments/:id',
      body,
      async () => {
        const existing = await fetchPaymentRow(caller, id);
        if (existing.voided_at) {
          throw new ApiError(
            'PAYMENT_LOCKED',
            'payment is voided; edits are not permitted',
            409,
          );
        }

        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.paid_at !== undefined) patch.paid_at = body.paid_at;
        if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents;
        if (body.payment_method_id !== undefined)
          patch.payment_method_id = body.payment_method_id;
        if (body.reference !== undefined) patch.reference = body.reference;
        if (body.description !== undefined) patch.description = body.description;
        if (body.external_ref !== undefined) patch.external_ref = body.external_ref;
        if (body.exchange_rate !== undefined) patch.exchange_rate = body.exchange_rate;

        const { data, error } = await admin()
          .from('payments')
          .update(patch)
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PAYMENT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'payment update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToPayment(data as PaymentRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /payments/:id/void
// =========================================================================
export async function voidPayment({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.void');
    const body = await parseBody(req, PaymentVoidSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /payments/:id/void',
      body,
      async () => {
        const existing = await fetchPaymentRow(caller, id);
        if (existing.voided_at) {
          // Idempotent: already voided. Return the row unchanged.
          return { status: 200, body: { data: rowToPayment(existing) } };
        }
        const nowIso = new Date().toISOString();
        const { data, error } = await admin()
          .from('payments')
          .update({
            voided_at: nowIso,
            void_reason: body.void_reason,
            updated_at: nowIso,
          })
          .eq('id', id)
          .eq('org_id', caller.orgId)
          .select(PAYMENT_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'payment void failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToPayment(data as PaymentRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

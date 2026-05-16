/**
 * invoicing-api — /payments handlers (Wave 5 / Phase 8 + Wave 8 / Phase 12).
 *
 * Endpoints:
 *   GET    /payments                — list (filters: customer_id, invoice_id,
 *                                      from, to, currency_code)
 *   POST   /payments                — record payment (optional allocations[])
 *   GET    /payments/:id            — detail
 *   PATCH  /payments/:id            — edit non-voided payment
 *   POST   /payments/:id/void       — set voided_at + void_reason
 *   POST   /payments/:id/allocate   — add allocation rows to an existing payment
 *
 * The recompute trigger on `payments` (added in 0052) handles invoice
 * rollup automatically — handlers do NOT touch `invoices.paid_cents` or
 * `invoices.balance_cents`. The 0052 BEFORE INSERT trigger
 * `assert_invoice_payment_currency` enforces currency parity with the
 * parent invoice (the legacy 1:1 link only).
 *
 * Wave 8 / Phase 12 / closes R-W5-PAY-01: POST /payments accepts an
 * optional `allocations[]` array. When present:
 *   - SUM(allocations.amount_cents) MUST equal body.amount_cents (422).
 *   - Every invoice_id must belong to the caller's org AND share currency.
 *   - The payment row is inserted with invoice_id := allocations[0].invoice_id
 *     (the 1:1 FK is still NOT NULL — first allocation acts as the
 *     representative invoice for downstream consumers that only read
 *     payments.invoice_id).
 *   - payment_allocations rows are bulk-inserted; the 0059 trigger
 *     tg_pa_recompute_invoice recomputes every touched invoice's totals.
 * When `allocations` is absent, the legacy single-invoice path is
 * unchanged and no allocation rows are written. recompute_invoice_totals
 * falls back to the 1:1 link in that case.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  PaymentAllocateSchema,
  PaymentCreateSchema,
  PaymentPatchSchema,
  PaymentSchema,
  PaymentVoidSchema,
  type Payment,
  type PaymentAllocationInput,
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
        // Wave 8: allocations branch. Validate every target invoice, then
        // the 1:1 representative invoice (allocations[0].invoice_id).
        let representativeInvoiceId = body.invoice_id;
        if (body.allocations && body.allocations.length > 0) {
          // amount_cents must match the sum of allocations.
          const allocSum = body.allocations.reduce((s, a) => s + a.amount_cents, 0);
          if (allocSum !== body.amount_cents) {
            throw new ApiError(
              'VALIDATION_ERROR',
              `SUM(allocations.amount_cents)=${allocSum} must equal amount_cents=${body.amount_cents}`,
              422,
            );
          }

          // Verify every allocation invoice is in caller's org + currency
          // parity with the payment.
          const invoiceIds = Array.from(new Set(body.allocations.map((a) => a.invoice_id)));
          const { data: invs, error: invsErr } = await admin()
            .from('invoices')
            .select('id, currency_code, customer_id, status')
            .in('id', invoiceIds)
            .eq('org_id', caller.orgId)
            .is('deleted_at', null);
          if (invsErr) {
            throw new ApiError('INTERNAL_ERROR', 'invoices lookup failed', 500, {
              detail: invsErr.message,
            });
          }
          const invRows = (invs ?? []) as {
            id: string;
            currency_code: string;
            customer_id: string;
            status: string;
          }[];
          if (invRows.length !== invoiceIds.length) {
            throw new ApiError(
              'VALIDATION_ERROR',
              'one or more allocation invoice_id values not found in caller org',
              422,
            );
          }
          for (const inv of invRows) {
            if (inv.currency_code !== body.currency_code) {
              throw new ApiError(
                'VALIDATION_ERROR',
                `invoice ${inv.id} currency ${inv.currency_code} does not match payment currency ${body.currency_code}`,
                422,
              );
            }
            if (inv.status === 'draft' || inv.status === 'cancelled') {
              throw new ApiError(
                'STATE_CONFLICT',
                `cannot allocate payment against invoice ${inv.id} in ${inv.status} state`,
                409,
              );
            }
            if (inv.customer_id !== body.customer_id) {
              throw new ApiError(
                'VALIDATION_ERROR',
                `invoice ${inv.id} customer does not match payment customer`,
                422,
              );
            }
          }
          // The 1:1 payments.invoice_id FK is still NOT NULL. Pin it to
          // the first allocation's invoice; legacy consumers that only
          // read payments.invoice_id still see a sane referent. The
          // body's top-level invoice_id is preserved when allocations
          // omitted; when allocations are present, we authoritatively
          // override it to allocations[0].invoice_id to keep the FK and
          // the allocation set consistent.
          representativeInvoiceId = body.allocations[0].invoice_id;
        } else {
          // Legacy single-invoice path. Validate the 1:1 link.
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
        }

        const paymentNumber = await nextPaymentNumber(caller.orgId);
        const { data, error } = await admin()
          .from('payments')
          .insert({
            org_id: caller.orgId,
            payment_number: paymentNumber,
            customer_id: body.customer_id,
            invoice_id: representativeInvoiceId,
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
        const paymentRow = data as PaymentRow;

        // Bulk insert allocation rows if provided. The 0059 trigger
        // tg_pa_recompute_invoice recomputes every touched invoice.
        if (body.allocations && body.allocations.length > 0) {
          const allocRows = body.allocations.map((a) => ({
            org_id: caller.orgId,
            payment_id: paymentRow.id,
            invoice_id: a.invoice_id,
            amount_cents: a.amount_cents,
            created_by: caller.userId,
            updated_by: caller.userId,
          }));
          const { error: allocErr } = await admin()
            .from('payment_allocations')
            .insert(allocRows);
          if (allocErr) {
            // Best-effort rollback of the payment row.
            await admin()
              .from('payments')
              .delete()
              .eq('id', paymentRow.id)
              .eq('org_id', caller.orgId);
            throw new ApiError('INTERNAL_ERROR', 'payment_allocations insert failed', 500, {
              detail: allocErr.message,
            });
          }
        }

        return { status: 201, body: { data: rowToPayment(paymentRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================================
// POST /payments/:id/allocate
// =========================================================================
/**
 * Adds allocation rows to an existing payment. The sum of (new allocations
 * + existing allocations + the legacy 1:1 amount if no allocations existed
 * yet) must not exceed the payment's amount_cents — 422 otherwise.
 *
 * Once the first allocation lands on a previously-1:1 payment, the trigger
 * + recompute_invoice_totals stop crediting the legacy 1:1 link for paid
 * sums (they read live allocations instead), so callers should pass the
 * full breakdown in one call to avoid temporary balance drift.
 */
export async function allocatePayment({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'payments.write');
    const body = await parseBody(req, PaymentAllocateSchema);
    const id = params.id;

    return await respondWithIdempotency(
      req,
      caller,
      'invoicing-api',
      'POST /payments/:id/allocate',
      body,
      async () => {
        const payment = await fetchPaymentRow(caller, id);
        if (payment.voided_at) {
          throw new ApiError(
            'PAYMENT_LOCKED',
            'payment is voided; allocations are not permitted',
            409,
          );
        }

        // Existing live allocations.
        const { data: existingAllocsData, error: eErr } = await admin()
          .from('payment_allocations')
          .select('id, invoice_id, amount_cents')
          .eq('payment_id', id)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null);
        if (eErr) {
          throw new ApiError('INTERNAL_ERROR', 'payment_allocations lookup failed', 500, {
            detail: eErr.message,
          });
        }
        const existing = (existingAllocsData ?? []) as {
          id: string;
          invoice_id: string;
          amount_cents: number;
        }[];

        // Compute the headroom.
        const existingSum = existing.reduce((s, r) => s + Number(r.amount_cents), 0);
        // When no allocations exist yet, the legacy 1:1 amount IS the
        // current allocated amount (the recompute fn falls back to it).
        // The first allocate call's totals must therefore be reconciled
        // against the legacy 1:1 amount too.
        const legacyHeld = existing.length === 0 ? Number(payment.amount_cents) : 0;
        const newSum = body.allocations.reduce((s, a) => s + a.amount_cents, 0);
        if (existingSum + legacyHeld + newSum > Number(payment.amount_cents)) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'allocations would exceed payment amount_cents',
            422,
            {
              payment_amount_cents: Number(payment.amount_cents),
              existing_allocations_sum: existingSum,
              legacy_1_to_1_held: legacyHeld,
              new_allocations_sum: newSum,
            },
          );
        }

        // Validate every new allocation invoice is in caller's org + matches
        // payment currency + customer + not a UNIQUE conflict against an
        // existing live allocation.
        const newInvoiceIds = Array.from(new Set(body.allocations.map((a) => a.invoice_id)));
        const { data: invs, error: iErr } = await admin()
          .from('invoices')
          .select('id, currency_code, customer_id, status')
          .in('id', newInvoiceIds)
          .eq('org_id', caller.orgId)
          .is('deleted_at', null);
        if (iErr) {
          throw new ApiError('INTERNAL_ERROR', 'invoices lookup failed', 500, {
            detail: iErr.message,
          });
        }
        const invRows = (invs ?? []) as {
          id: string;
          currency_code: string;
          customer_id: string;
          status: string;
        }[];
        if (invRows.length !== newInvoiceIds.length) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'one or more allocation invoice_id values not found in caller org',
            422,
          );
        }
        for (const inv of invRows) {
          if (inv.currency_code !== payment.currency_code) {
            throw new ApiError(
              'VALIDATION_ERROR',
              `invoice ${inv.id} currency ${inv.currency_code} does not match payment currency ${payment.currency_code}`,
              422,
            );
          }
          if (inv.customer_id !== payment.customer_id) {
            throw new ApiError(
              'VALIDATION_ERROR',
              `invoice ${inv.id} customer does not match payment customer`,
              422,
            );
          }
        }

        const allocRows = body.allocations.map((a: PaymentAllocationInput) => ({
          org_id: caller.orgId,
          payment_id: id,
          invoice_id: a.invoice_id,
          amount_cents: a.amount_cents,
          created_by: caller.userId,
          updated_by: caller.userId,
        }));
        const { error: insErr } = await admin()
          .from('payment_allocations')
          .insert(allocRows);
        if (insErr) {
          if (insErr.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'payment already has a live allocation against one of these invoices',
              409,
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'payment_allocations insert failed', 500, {
            detail: insErr.message,
          });
        }

        const refreshed = await fetchPaymentRow(caller, id);
        return { status: 200, body: { data: rowToPayment(refreshed) } };
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

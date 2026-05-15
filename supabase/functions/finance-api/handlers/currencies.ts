/**
 * finance-api — /currencies handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §7:
 *   GET    /currencies                  — list (optional ?is_active)
 *   POST   /currencies                  — upsert by `code`
 *   PATCH  /currencies/:code            — update display (code is immutable)
 *
 * `public.currencies` is a GLOBAL table (no `org_id` column); rows are
 * shared across all orgs. The caller-org check is still required at the
 * handler boundary (`requireCaller`), but queries do NOT include
 * `.eq('org_id', ...)`. Pattern A defense-in-depth applies only to
 * org-scoped tables.
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  CurrencyPatchSchema,
  CurrencySchema,
  CurrencyUpsertSchema,
  type Currency,
} from '../../_shared/types.ts';
import { admin, parseBody, requireCap, respondWithIdempotency } from '../_helpers.ts';

const CURRENCY_COLS =
  'code, label, symbol, symbol_position, decimal_sep, thousand_sep, ' +
  'cent_precision, zero_format, is_active, created_at, updated_at';

interface CurrencyRow {
  code: string;
  label: string;
  symbol: string;
  symbol_position: string;
  decimal_sep: string;
  thousand_sep: string;
  cent_precision: number;
  zero_format: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

function rowToCurrency(row: CurrencyRow): Currency {
  return CurrencySchema.parse(row);
}

// ============================================================ GET /currencies
export async function listCurrencies({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.currencies.read');

    const activeOnly = url.searchParams.get('is_active');

    let query = admin().from('currencies').select(CURRENCY_COLS).order('code', { ascending: true });
    if (activeOnly === 'true') query = query.eq('is_active', true);
    else if (activeOnly === 'false') query = query.eq('is_active', false);

    const { data, error } = await query;
    if (error) {
      return err('INTERNAL_ERROR', 'currency list query failed', { detail: error.message }, 500, {
        req,
      });
    }
    const items = ((data ?? []) as CurrencyRow[]).map(rowToCurrency);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// =========================================================== POST /currencies
export async function upsertCurrency({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.currencies.write');
    const body = await parseBody(req, CurrencyUpsertSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /currencies',
      body,
      async () => {
        const code = body.code.toUpperCase();
        const row = {
          code,
          label: body.label,
          symbol: body.symbol,
          symbol_position: body.symbol_position,
          decimal_sep: body.decimal_sep,
          thousand_sep: body.thousand_sep,
          cent_precision: body.cent_precision,
          zero_format: body.zero_format,
          is_active: body.is_active,
        };
        const { data, error } = await admin()
          .from('currencies')
          .upsert(row, { onConflict: 'code' })
          .select(CURRENCY_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'currency upsert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToCurrency(data as CurrencyRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ===================================================== PATCH /currencies/:code
export async function patchCurrency({ req, params }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.currencies.write');
    const code = params.code.toUpperCase();
    const body = await parseBody(req, CurrencyPatchSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'PATCH /currencies/:code',
      body,
      async () => {
        // Confirm existence.
        const { data: existing, error: lookupErr } = await admin()
          .from('currencies')
          .select('code')
          .eq('code', code)
          .maybeSingle();
        if (lookupErr) {
          throw new ApiError('INTERNAL_ERROR', 'currency lookup failed', 500, {
            detail: lookupErr.message,
          });
        }
        if (!existing) throw new ApiError('NOT_FOUND', 'currency not found', 404);

        const patch: Record<string, unknown> = {};
        if (body.label !== undefined) patch.label = body.label;
        if (body.symbol !== undefined) patch.symbol = body.symbol;
        if (body.symbol_position !== undefined) patch.symbol_position = body.symbol_position;
        if (body.decimal_sep !== undefined) patch.decimal_sep = body.decimal_sep;
        if (body.thousand_sep !== undefined) patch.thousand_sep = body.thousand_sep;
        if (body.cent_precision !== undefined) patch.cent_precision = body.cent_precision;
        if (body.zero_format !== undefined) patch.zero_format = body.zero_format;
        if (body.is_active !== undefined) patch.is_active = body.is_active;

        const { data, error } = await admin()
          .from('currencies')
          .update(patch)
          .eq('code', code)
          .select(CURRENCY_COLS)
          .single();
        if (error || !data) {
          throw new ApiError('INTERNAL_ERROR', 'currency update failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 200, body: { data: rowToCurrency(data as CurrencyRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

/**
 * finance-api — /exchange-rates handlers.
 *
 * Routes per TS1/09-api/00-API-CONTRACT.md §7:
 *   GET    /exchange-rates?base_code=&quote_code=&from=&to=
 *   POST   /exchange-rates              — manual rate insert
 *
 * `public.exchange_rates` has UNIQUE(base_code, quote_code, as_of). The
 * table is global (no `org_id`); duplicate posts return 409 STATE_CONFLICT
 * with `code: 'EXCHANGE_RATE_EXISTS'` (a domain code; not added to the
 * global enum — see API contract §0.3 about extensible codes).
 */

import type { Ctx } from '../../_shared/route.ts';
import { ok, err, ApiError, fromApiError } from '../../_shared/responses.ts';
import { requireCaller } from '../../_shared/tenant.ts';
import {
  ExchangeRateInsertSchema,
  ExchangeRateSchema,
  type ExchangeRate,
} from '../../_shared/types.ts';
import { admin, parseBody, parseLimit, requireCap, respondWithIdempotency } from '../_helpers.ts';

const RATE_COLS =
  'id, base_code, quote_code, rate, as_of, source, created_at, created_by';

interface ExchangeRateRow {
  id: string;
  base_code: string;
  quote_code: string;
  rate: string | number;
  as_of: string;
  source: string;
  created_at: string;
  created_by: string | null;
}

function rowToRate(row: ExchangeRateRow): ExchangeRate {
  return ExchangeRateSchema.parse(row);
}

// ====================================================== GET /exchange-rates
export async function listExchangeRates({ req, url }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.exchange_rates.read');

    const limit = parseLimit(url);
    const baseCode = url.searchParams.get('base_code');
    const quoteCode = url.searchParams.get('quote_code');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let query = admin()
      .from('exchange_rates')
      .select(RATE_COLS)
      .order('as_of', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (baseCode) query = query.eq('base_code', baseCode.toUpperCase());
    if (quoteCode) query = query.eq('quote_code', quoteCode.toUpperCase());
    if (from) query = query.gte('as_of', from);
    if (to) query = query.lte('as_of', to);

    const { data, error } = await query;
    if (error) {
      return err(
        'INTERNAL_ERROR',
        'exchange rate list query failed',
        { detail: error.message },
        500,
        { req },
      );
    }
    const items = ((data ?? []) as ExchangeRateRow[]).map(rowToRate);
    return ok({ items, next_cursor: null }, undefined, { req });
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

// ===================================================== POST /exchange-rates
export async function createExchangeRate({ req }: Ctx): Promise<Response> {
  try {
    const caller = requireCaller(req);
    requireCap(caller, 'finance.exchange_rates.write');
    const body = await parseBody(req, ExchangeRateInsertSchema);

    return await respondWithIdempotency(
      req,
      caller,
      'POST /exchange-rates',
      body,
      async () => {
        const insertRow = {
          base_code: body.base_code.toUpperCase(),
          quote_code: body.quote_code.toUpperCase(),
          rate: body.rate,
          as_of: body.as_of,
          source: body.source,
          created_by: caller.userId,
        };
        const { data, error } = await admin()
          .from('exchange_rates')
          .insert(insertRow)
          .select(RATE_COLS)
          .single();
        if (error || !data) {
          // 23505 = unique_violation (Postgres).
          if (error?.code === '23505') {
            throw new ApiError(
              'STATE_CONFLICT',
              'exchange rate already exists for this base/quote/as_of',
              409,
              { code: 'EXCHANGE_RATE_EXISTS' },
            );
          }
          throw new ApiError('INTERNAL_ERROR', 'exchange rate insert failed', 500, {
            detail: error?.message,
          });
        }
        return { status: 201, body: { data: rowToRate(data as ExchangeRateRow) } };
      },
    );
  } catch (e) {
    if (e instanceof ApiError) return fromApiError(e, req);
    throw e;
  }
}

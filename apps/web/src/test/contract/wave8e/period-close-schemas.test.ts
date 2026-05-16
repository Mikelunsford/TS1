import { describe, it, expect } from 'vitest';

import {
  PeriodCloseCreateInputSchema,
  PeriodClosePatchInputSchema,
  PeriodCloseClosePayloadSchema,
  PeriodCloseReopenPayloadSchema,
  TrialBalanceQuerySchema,
  ProfitLossQuerySchema,
  BalanceSheetQuerySchema,
  TrialBalanceReportSchema,
  ProfitLossReportSchema,
  BalanceSheetReportSchema,
} from '@/lib/types';

/**
 * Unit coverage for Wave 8e Zod schemas. The Zod-canon parity test
 * (`types.contract.test.ts`) already enforces structural equality between
 * the SPA and BE copies; this file pins semantics callers depend on.
 */

describe('PeriodCloseCreateInputSchema', () => {
  it('accepts a minimal create payload', () => {
    const v = PeriodCloseCreateInputSchema.parse({
      period_start: '2026-01-01',
      period_end: '2026-01-31',
    });
    expect(v.period_start).toBe('2026-01-01');
    expect(v.period_end).toBe('2026-01-31');
  });

  it('accepts optional notes', () => {
    expect(() =>
      PeriodCloseCreateInputSchema.parse({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        notes: 'January close',
      }),
    ).not.toThrow();
  });

  it('rejects unknown keys (strict)', () => {
    expect(() =>
      PeriodCloseCreateInputSchema.parse({
        period_start: '2026-01-01',
        period_end: '2026-01-31',
        bogus: true,
      } as never),
    ).toThrow();
  });

  it('rejects malformed date strings', () => {
    expect(() =>
      PeriodCloseCreateInputSchema.parse({
        period_start: '2026/01/01',
        period_end: '2026-01-31',
      }),
    ).toThrow();
  });
});

describe('PeriodClosePatchInputSchema', () => {
  it('accepts an empty patch', () => {
    expect(() => PeriodClosePatchInputSchema.parse({})).not.toThrow();
  });

  it('accepts open and in_review only', () => {
    expect(() => PeriodClosePatchInputSchema.parse({ status: 'open' })).not.toThrow();
    expect(() => PeriodClosePatchInputSchema.parse({ status: 'in_review' })).not.toThrow();
  });

  it('rejects closed / reopened (must go through dedicated endpoints)', () => {
    expect(() => PeriodClosePatchInputSchema.parse({ status: 'closed' } as never)).toThrow();
    expect(() => PeriodClosePatchInputSchema.parse({ status: 'reopened' } as never)).toThrow();
  });
});

describe('PeriodCloseReopenPayloadSchema', () => {
  it('requires a non-empty reason', () => {
    expect(() => PeriodCloseReopenPayloadSchema.parse({})).toThrow();
    expect(() => PeriodCloseReopenPayloadSchema.parse({ reason: '' })).toThrow();
    expect(() =>
      PeriodCloseReopenPayloadSchema.parse({ reason: 'audit adjustment' }),
    ).not.toThrow();
  });
});

describe('PeriodCloseClosePayloadSchema', () => {
  it('accepts an empty payload', () => {
    expect(() => PeriodCloseClosePayloadSchema.parse({})).not.toThrow();
  });

  it('accepts optional notes', () => {
    expect(() =>
      PeriodCloseClosePayloadSchema.parse({ notes: 'final close' }),
    ).not.toThrow();
  });
});

describe('Report query schemas', () => {
  it('TrialBalanceQuerySchema defaults currency to USD', () => {
    const v = TrialBalanceQuerySchema.parse({ as_of: '2026-01-31' });
    expect(v.currency).toBe('USD');
  });

  it('ProfitLossQuerySchema requires start + end', () => {
    expect(() => ProfitLossQuerySchema.parse({ start: '2026-01-01' } as never)).toThrow();
    const v = ProfitLossQuerySchema.parse({ start: '2026-01-01', end: '2026-01-31' });
    expect(v.currency).toBe('USD');
  });

  it('BalanceSheetQuerySchema rejects 4-letter currency codes', () => {
    expect(() =>
      BalanceSheetQuerySchema.parse({ as_of: '2026-01-31', currency: 'USDX' }),
    ).toThrow();
  });
});

describe('Report output schemas', () => {
  it('TrialBalanceReportSchema accepts a zero-row report', () => {
    const v = TrialBalanceReportSchema.parse({
      as_of: '2026-01-31',
      currency: 'USD',
      rows: [],
      total_debit_cents: 0,
      total_credit_cents: 0,
      is_balanced: true,
    });
    expect(v.rows).toEqual([]);
  });

  it('ProfitLossReportSchema accepts a single net_income totals row', () => {
    const v = ProfitLossReportSchema.parse({
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      currency: 'USD',
      rows: [
        {
          account_id: null,
          account_code: 'NET_INCOME',
          account_name: 'Net Income',
          account_type: 'total',
          revenue_cents: 100000,
          expense_cents: 70000,
          net_income_cents: 30000,
          is_total: true,
        },
      ],
      total_revenue_cents: 100000,
      total_expense_cents: 70000,
      net_income_cents: 30000,
    });
    expect(v.rows.length).toBe(1);
  });

  it('BalanceSheetReportSchema captures the balance identity', () => {
    const v = BalanceSheetReportSchema.parse({
      as_of: '2026-01-31',
      currency: 'USD',
      rows: [],
      total_assets_cents: 0,
      total_liabilities_cents: 0,
      total_equity_cents: 0,
      retained_earnings_cents: 0,
      is_balanced: true,
    });
    expect(v.is_balanced).toBe(true);
  });
});

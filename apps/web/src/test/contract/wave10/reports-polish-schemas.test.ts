import { describe, it, expect } from 'vitest';

import {
  ArAgingQuerySchema,
  ArAgingReportSchema,
  CashPositionQuerySchema,
  CashPositionReportSchema,
  DashboardSummarySchema,
  ExpenseByCategoryQuerySchema,
  ExpenseByCategoryReportSchema,
  SalesByCustomerQuerySchema,
  SalesByCustomerReportSchema,
  SalesByItemQuerySchema,
  SalesByItemReportSchema,
} from '@/lib/types';

/**
 * Schema contract tests for Wave 10 / Phase 18 polish reports.
 *
 * The Zod-canon parity test (`types.contract.test.ts`) already enforces
 * structural equality between SPA and BE copies of every schema; this file
 * pins the semantics each caller depends on (default currency, strict
 * unknown-key rejection, malformed dates, required-field presence).
 *
 * Wire-shape integration (HTTP contract tests against the deployed Edge
 * Function) for the 5 new /reports/* endpoints runs out of CI's separate
 * cloud-targeted suite once Agent A3 lands migration 0067.
 */

describe('Wave 10 — report query schemas', () => {
  it('ArAgingQuerySchema defaults currency to USD', () => {
    const v = ArAgingQuerySchema.parse({ as_of: '2026-05-16' });
    expect(v.currency).toBe('USD');
  });

  it('ArAgingQuerySchema rejects unknown keys', () => {
    expect(() =>
      ArAgingQuerySchema.parse({ as_of: '2026-05-16', bogus: true } as never),
    ).toThrow();
  });

  it('ArAgingQuerySchema rejects 4-letter currency codes', () => {
    expect(() =>
      ArAgingQuerySchema.parse({ as_of: '2026-05-16', currency: 'USDX' }),
    ).toThrow();
  });

  it('SalesByCustomerQuerySchema requires start + end', () => {
    expect(() =>
      SalesByCustomerQuerySchema.parse({ start: '2026-05-01' } as never),
    ).toThrow();
    expect(() =>
      SalesByCustomerQuerySchema.parse({ start: '2026-05-01', end: '2026-05-16' }),
    ).not.toThrow();
  });

  it('SalesByItemQuerySchema rejects malformed dates', () => {
    expect(() =>
      SalesByItemQuerySchema.parse({ start: '05/01/2026', end: '2026-05-16' }),
    ).toThrow();
  });

  it('CashPositionQuerySchema requires as_of', () => {
    expect(() => CashPositionQuerySchema.parse({} as never)).toThrow();
  });

  it('ExpenseByCategoryQuerySchema requires both bounds', () => {
    expect(() =>
      ExpenseByCategoryQuerySchema.parse({ end: '2026-05-16' } as never),
    ).toThrow();
  });
});

describe('Wave 10 — report response schemas', () => {
  it('ArAgingReportSchema accepts a zero-row report', () => {
    const v = ArAgingReportSchema.parse({
      as_of: '2026-05-16',
      currency: 'USD',
      rows: [],
      total_current_cents: 0,
      total_days_1_30_cents: 0,
      total_days_31_60_cents: 0,
      total_days_61_90_cents: 0,
      total_days_over_90_cents: 0,
      total_outstanding_cents: 0,
    });
    expect(v.rows).toEqual([]);
  });

  it('ArAgingReportSchema accepts a fully populated row', () => {
    const v = ArAgingReportSchema.parse({
      as_of: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          customer_id: '00000000-0000-0000-0000-000000000001',
          customer_name: 'Acme',
          current_cents: 1000,
          days_1_30_cents: 200,
          days_31_60_cents: 0,
          days_61_90_cents: 0,
          days_over_90_cents: 0,
          total_cents: 1200,
        },
      ],
      total_current_cents: 1000,
      total_days_1_30_cents: 200,
      total_days_31_60_cents: 0,
      total_days_61_90_cents: 0,
      total_days_over_90_cents: 0,
      total_outstanding_cents: 1200,
    });
    const first = v.rows[0];
    expect(first?.total_cents).toBe(1200);
  });

  it('SalesByCustomerReportSchema accepts totals row', () => {
    const v = SalesByCustomerReportSchema.parse({
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      currency: 'USD',
      rows: [],
      total_invoice_count: 0,
      total_subtotal_cents: 0,
      total_tax_cents: 0,
      total_sales_cents: 0,
    });
    expect(v.currency).toBe('USD');
  });

  it('SalesByItemReportSchema allows null item_id (uncategorized line)', () => {
    const v = SalesByItemReportSchema.parse({
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      currency: 'USD',
      rows: [
        {
          item_id: null,
          item_code: null,
          item_name: 'Custom line',
          quantity: 2.5,
          subtotal_cents: 5000,
          total_cents: 5500,
        },
      ],
      total_quantity: 2.5,
      total_subtotal_cents: 5000,
      total_sales_cents: 5500,
    });
    const first = v.rows[0];
    expect(first?.item_id).toBeNull();
    expect(first?.quantity).toBeCloseTo(2.5);
  });

  it('CashPositionReportSchema captures total_cash_cents', () => {
    const v = CashPositionReportSchema.parse({
      as_of: '2026-05-16',
      currency: 'USD',
      rows: [],
      total_cash_cents: 0,
    });
    expect(v.total_cash_cents).toBe(0);
  });

  it('ExpenseByCategoryReportSchema accepts null category_id', () => {
    const v = ExpenseByCategoryReportSchema.parse({
      period_start: '2026-05-01',
      period_end: '2026-05-31',
      currency: 'USD',
      rows: [
        {
          category_id: null,
          category_name: 'Uncategorized',
          expense_count: 3,
          total_cents: 9999,
        },
      ],
      total_expense_count: 3,
      total_expenses_cents: 9999,
    });
    const first = v.rows[0];
    expect(first?.category_id).toBeNull();
  });
});

describe('Wave 10 — dashboard summary schema', () => {
  it('DashboardSummarySchema rejects missing tiles', () => {
    expect(() =>
      DashboardSummarySchema.parse({
        as_of: '2026-05-16',
        currency: 'USD',
        period_start: '2026-05-01',
        period_end: '2026-05-16',
        cash_on_hand_cents: 0,
        mtd_revenue_cents: 0,
        mtd_expense_cents: 0,
      } as never),
    ).toThrow();
  });

  it('DashboardSummarySchema accepts a fully populated payload', () => {
    const v = DashboardSummarySchema.parse({
      as_of: '2026-05-16',
      currency: 'USD',
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      ar_aging_summary: {
        current_cents: 1000,
        days_1_30_cents: 200,
        days_31_60_cents: 0,
        days_61_90_cents: 0,
        days_over_90_cents: 0,
      },
      cash_on_hand_cents: 250000,
      mtd_revenue_cents: 80000,
      mtd_expense_cents: 20000,
    });
    expect(v.ar_aging_summary.current_cents).toBe(1000);
    expect(v.cash_on_hand_cents).toBe(250000);
  });
});

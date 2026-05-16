/**
 * Smoke + filter-interaction tests for the 5 Wave 10 / Phase 18 report
 * pages. Each test renders the page, mocks the service, asserts the
 * rendered rows, and exercises a filter change.
 *
 * Mocks the underlying services + the inventory CurrencyPicker (which
 * depends on the global currencies-list endpoint).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ArAgingReportPage from '../ArAgingReportPage';
import CashPositionReportPage from '../CashPositionReportPage';
import ExpenseByCategoryReportPage from '../ExpenseByCategoryReportPage';
import SalesByCustomerReportPage from '../SalesByCustomerReportPage';
import SalesByItemReportPage from '../SalesByItemReportPage';

const arAgingMock = vi.fn();
const salesByCustomerMock = vi.fn();
const salesByItemMock = vi.fn();
const cashPositionMock = vi.fn();
const expenseByCategoryMock = vi.fn();

vi.mock('@/lib/services/reportsService', () => ({
  getArAgingReport: (...args: unknown[]) => arAgingMock(...args),
  getSalesByCustomerReport: (...args: unknown[]) => salesByCustomerMock(...args),
  getSalesByItemReport: (...args: unknown[]) => salesByItemMock(...args),
  getCashPositionReport: (...args: unknown[]) => cashPositionMock(...args),
  getExpenseByCategoryReport: (...args: unknown[]) => expenseByCategoryMock(...args),
  getDashboardSummary: vi.fn(),
}));

vi.mock('@/components/inventory/CurrencyPicker', () => ({
  CurrencyPicker: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (c: string | null) => void;
  }) => (
    <select
      aria-label="Currency"
      data-testid="currency-picker"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="USD">USD</option>
      <option value="EUR">EUR</option>
    </select>
  ),
}));

vi.mock('@/lib/hooks/useOrgFlags', () => ({
  useOrgFlags: () => ({ data: {}, isLoading: false }),
  useIsFlagOn: () => ({ isOn: false, isLoading: false }),
}));

function renderWith(node: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  arAgingMock.mockReset();
  salesByCustomerMock.mockReset();
  salesByItemMock.mockReset();
  cashPositionMock.mockReset();
  expenseByCategoryMock.mockReset();
});

describe('ArAgingReportPage', () => {
  it('renders rows + totals + disables CSV export under the off-flag', async () => {
    arAgingMock.mockResolvedValue({
      as_of: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          customer_id: 'c1',
          customer_name: 'Acme',
          current_cents: 1000,
          days_1_30_cents: 0,
          days_31_60_cents: 0,
          days_61_90_cents: 0,
          days_over_90_cents: 0,
          total_cents: 1000,
        },
      ],
      total_current_cents: 1000,
      total_days_1_30_cents: 0,
      total_days_31_60_cents: 0,
      total_days_61_90_cents: 0,
      total_days_over_90_cents: 0,
      total_outstanding_cents: 1000,
    });
    renderWith(<ArAgingReportPage />);
    await waitFor(() => expect(screen.getByTestId('ar-aging-row-0')).toBeInTheDocument());
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByTestId('ar-aging-row-total')).toBeInTheDocument();
    expect(screen.getByTestId('report-export-ar-aging')).toBeDisabled();
  });

  it('refetches when the as-of date changes', async () => {
    arAgingMock.mockResolvedValue({
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
    renderWith(<ArAgingReportPage />);
    await waitFor(() => expect(arAgingMock).toHaveBeenCalled());
    arAgingMock.mockClear();
    fireEvent.change(screen.getByTestId('as-of-date'), { target: { value: '2026-04-30' } });
    await waitFor(() => expect(arAgingMock).toHaveBeenCalledWith('2026-04-30', 'USD'));
  });
});

describe('SalesByCustomerReportPage', () => {
  it('renders rows', async () => {
    salesByCustomerMock.mockResolvedValue({
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          customer_id: 'c1',
          customer_name: 'Acme',
          invoice_count: 3,
          subtotal_cents: 9000,
          tax_cents: 1000,
          total_cents: 10000,
        },
      ],
      total_invoice_count: 3,
      total_subtotal_cents: 9000,
      total_tax_cents: 1000,
      total_sales_cents: 10000,
    });
    renderWith(<SalesByCustomerReportPage />);
    await waitFor(() => expect(screen.getByTestId('sales-cust-row-0')).toBeInTheDocument());
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('flags an invalid date range', async () => {
    salesByCustomerMock.mockResolvedValue({
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      currency: 'USD',
      rows: [],
      total_invoice_count: 0,
      total_subtotal_cents: 0,
      total_tax_cents: 0,
      total_sales_cents: 0,
    });
    renderWith(<SalesByCustomerReportPage />);
    await waitFor(() => expect(salesByCustomerMock).toHaveBeenCalled());
    fireEvent.change(screen.getByTestId('date-range-end'), { target: { value: '2025-01-01' } });
    await waitFor(() => expect(screen.getByText('Invalid date range')).toBeInTheDocument());
  });
});

describe('SalesByItemReportPage', () => {
  it('renders item rows', async () => {
    salesByItemMock.mockResolvedValue({
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          item_id: 'i1',
          item_code: 'SKU-1',
          item_name: 'Widget',
          quantity: 5,
          subtotal_cents: 5000,
          total_cents: 5500,
        },
      ],
      total_quantity: 5,
      total_subtotal_cents: 5000,
      total_sales_cents: 5500,
    });
    renderWith(<SalesByItemReportPage />);
    await waitFor(() => expect(screen.getByTestId('sales-item-row-0')).toBeInTheDocument());
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
    expect(screen.getByText('Widget')).toBeInTheDocument();
  });
});

describe('CashPositionReportPage', () => {
  it('renders the cash accounts and total row', async () => {
    cashPositionMock.mockResolvedValue({
      as_of: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          account_id: 'a1',
          account_code: '1000',
          account_name: 'Cash',
          balance_cents: 250000,
        },
      ],
      total_cash_cents: 250000,
    });
    renderWith(<CashPositionReportPage />);
    await waitFor(() => expect(screen.getByTestId('cash-row-0')).toBeInTheDocument());
    expect(screen.getByText('1000')).toBeInTheDocument();
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByTestId('cash-row-total')).toBeInTheDocument();
  });
});

describe('ExpenseByCategoryReportPage', () => {
  it('renders categories with counts + totals', async () => {
    expenseByCategoryMock.mockResolvedValue({
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      currency: 'USD',
      rows: [
        {
          category_id: 'cat1',
          category_name: 'Travel',
          expense_count: 2,
          total_cents: 4500,
        },
      ],
      total_expense_count: 2,
      total_expenses_cents: 4500,
    });
    renderWith(<ExpenseByCategoryReportPage />);
    await waitFor(() => expect(screen.getByTestId('exp-cat-row-0')).toBeInTheDocument());
    expect(screen.getByText('Travel')).toBeInTheDocument();
    expect(screen.getByTestId('exp-cat-row-total')).toBeInTheDocument();
  });
});

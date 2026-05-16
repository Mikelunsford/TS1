/**
 * DashboardPage smoke: renders the 4 KPI tiles from a mocked /dashboard/summary.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DashboardPage from '../DashboardPage';

const summaryMock = vi.fn();
vi.mock('@/lib/services/reportsService', () => ({
  getDashboardSummary: () => summaryMock(),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DashboardPage', () => {
  beforeEach(() => {
    summaryMock.mockReset();
  });

  it('renders the 4 KPI tiles from a populated summary', async () => {
    summaryMock.mockResolvedValue({
      as_of: '2026-05-16',
      currency: 'USD',
      period_start: '2026-05-01',
      period_end: '2026-05-16',
      ar_aging_summary: {
        current_cents: 1000,
        days_1_30_cents: 200,
        days_31_60_cents: 100,
        days_61_90_cents: 0,
        days_over_90_cents: 50,
      },
      cash_on_hand_cents: 250000,
      mtd_revenue_cents: 80000,
      mtd_expense_cents: 20000,
    });
    renderPage();
    await waitFor(() => expect(screen.getByTestId('dashboard-tile-grid')).toBeInTheDocument());
    expect(screen.getByTestId('tile-cash-on-hand')).toBeInTheDocument();
    expect(screen.getByTestId('tile-mtd-revenue')).toBeInTheDocument();
    expect(screen.getByTestId('tile-mtd-expense')).toBeInTheDocument();
    expect(screen.getByTestId('tile-ar-aging-summary')).toBeInTheDocument();
    expect(screen.getByTestId('aging-current')).toHaveTextContent('Current');
    expect(screen.getByTestId('aging-1-30')).toHaveTextContent('1–30');
    expect(screen.getByTestId('aging-over-90')).toBeInTheDocument();
  });

  it('renders an error state when the summary fetch fails', async () => {
    summaryMock.mockRejectedValue(new Error('boom'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Could not load dashboard')).toBeInTheDocument());
  });
});

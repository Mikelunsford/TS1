/**
 * PortalStatementPage — service-mocked render asserts aging table values.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PortalStatementPage from '../PortalStatementPage';

const statementMock = vi.fn();
vi.mock('@/lib/services/portalService', () => ({
  getPortalStatement: (opts: unknown) => statementMock(opts),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PortalStatementPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PortalStatementPage', () => {
  it('renders all 5 buckets + total', async () => {
    statementMock.mockResolvedValueOnce({
      as_of: '2026-05-16',
      currency_code: 'USD',
      aging: {
        customer_id: 'c1',
        customer_name: 'Acme',
        current_cents: 10000,
        days_1_30_cents: 5000,
        days_31_60_cents: 2500,
        days_61_90_cents: 0,
        days_over_90_cents: 1000,
        total_cents: 18500,
      },
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Current')).toBeInTheDocument();
    });
    expect(screen.getByText('1 – 30 days')).toBeInTheDocument();
    expect(screen.getByText('31 – 60 days')).toBeInTheDocument();
    expect(screen.getByText('61 – 90 days')).toBeInTheDocument();
    expect(screen.getByText('Over 90 days')).toBeInTheDocument();
    expect(screen.getByText('Total outstanding')).toBeInTheDocument();
  });
});

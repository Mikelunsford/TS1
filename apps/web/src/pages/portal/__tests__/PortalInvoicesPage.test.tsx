/**
 * PortalInvoicesPage — service-mocked render asserts list+filter UI.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PortalInvoicesPage from '../PortalInvoicesPage';

const listMock = vi.fn();
vi.mock('@/lib/services/portalService', () => ({
  listPortalInvoices: (filters: unknown) => listMock(filters),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PortalInvoicesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PortalInvoicesPage', () => {
  it('renders rows from the service', async () => {
    listMock.mockResolvedValueOnce({
      items: [
        {
          id: 'i1',
          invoice_number: 'INV-2026-00001',
          issue_date: '2026-05-01',
          due_date: '2026-05-15',
          status: 'sent',
          total_cents: 25000,
          balance_cents: 25000,
          currency_code: 'USD',
        },
      ],
      next_cursor: null,
    });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('INV-2026-00001')).toBeInTheDocument();
    });
    expect(screen.getByText('Invoices')).toBeInTheDocument();
  });

  it('shows empty state', async () => {
    listMock.mockResolvedValueOnce({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No invoices yet.')).toBeInTheDocument();
    });
  });
});

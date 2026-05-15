import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QuotesListPage from './QuotesListPage';
import type { Quote, Role } from '@/lib/types';

const listQuotesMock = vi.fn();
vi.mock('@/lib/services/quotesService', () => ({
  listQuotes: (filters?: unknown) => listQuotesMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    quote_number: 'Q-0001',
    customer_id: '00000000-0000-0000-0000-0000000000bb',
    customer_name: 'Acme Co',
    contact_name: null,
    contact_email: null,
    service_type: 'co_pack',
    status: 'draft',
    origin: 'management',
    mode: 'new_quote',
    materials_only: false,
    requires_approval: false,
    job_type_id: null,
    opportunity_id: null,
    project_id: null,
    currency_code: 'USD',
    exchange_rate: null,
    tax_id: null,
    tax_rate_snapshot: null,
    subtotal_cents: 0,
    tax_cents: 0,
    discount_cents: 0,
    total_cents: 199900,
    notes: null,
    valid_until: null,
    state_changed_at: '2026-05-15T00:00:00.000Z',
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage(initial = '/quotes') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <QuotesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('QuotesListPage', () => {
  beforeEach(() => {
    listQuotesMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the quote rows returned by the service', async () => {
    mockRole('sales');
    listQuotesMock.mockResolvedValue({
      items: [
        makeQuote({ id: 'a', quote_number: 'Q-001', customer_name: 'Acme', total_cents: 199900 }),
        makeQuote({
          id: 'b',
          quote_number: 'Q-002',
          customer_name: 'Globex',
          total_cents: 50000,
          currency_code: 'EUR',
        }),
      ],
      next_cursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('Q-001')).toBeInTheDocument());
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Q-002')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
    expect(screen.getByText(/1,999\.00/)).toBeInTheDocument();
  });

  it('shows the New Quote link for sales but hides it for viewer', async () => {
    listQuotesMock.mockResolvedValue({ items: [], next_cursor: null });

    mockRole('sales');
    const { unmount } = renderPage();
    await waitFor(() => expect(listQuotesMock).toHaveBeenCalled());
    expect(screen.getByTestId('new-quote-link')).toBeInTheDocument();
    unmount();

    listQuotesMock.mockClear();
    mockRole('viewer');
    renderPage();
    await waitFor(() => expect(listQuotesMock).toHaveBeenCalled());
    expect(screen.queryByTestId('new-quote-link')).not.toBeInTheDocument();
  });

  it('applies the status filter from the URL to the service call', async () => {
    mockRole('sales');
    listQuotesMock.mockResolvedValue({ items: [], next_cursor: null });

    renderPage('/quotes?status=submitted');

    await waitFor(() => expect(listQuotesMock).toHaveBeenCalled());
    const args = listQuotesMock.mock.calls[0]?.[0];
    expect(args).toEqual({ status: 'submitted' });
  });
});

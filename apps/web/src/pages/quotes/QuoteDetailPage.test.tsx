import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QuoteDetailPage from './QuoteDetailPage';
import type { Quote, QuoteState, Role } from '@/lib/types';

const getQuoteMock = vi.fn();
vi.mock('@/lib/services/quotesService', () => ({
  getQuote: (id: string) => getQuoteMock(id),
  submitQuote: vi.fn(),
  approveQuote: vi.fn(),
  requestRevisionsQuote: vi.fn(),
  declineQuote: vi.fn(),
  sendQuote: vi.fn(),
  acceptQuote: vi.fn(),
  convertQuoteToProject: vi.fn(),
  duplicateQuote: vi.fn(),
}));

vi.mock('@/lib/services/quoteLineItemsService', () => ({
  listQuoteLines: () => Promise.resolve({ items: [], next_cursor: null }),
  appendQuoteLine: vi.fn(),
  patchQuoteLine: vi.fn(),
  deleteQuoteLine: vi.fn(),
  reorderQuoteLines: vi.fn(),
}));

// Item lookup inside the line editor — keep silent.
vi.mock('@/lib/services/itemsService', () => ({
  listItems: () => Promise.resolve({ items: [], next_cursor: null }),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeQuote(status: QuoteState, overrides: Partial<Quote> = {}): Quote {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    quote_number: 'Q-0001',
    customer_id: '00000000-0000-0000-0000-0000000000bb',
    customer_name: 'Acme Co',
    contact_name: 'Jane Doe',
    contact_email: 'jane@acme.test',
    service_type: 'co_pack',
    status,
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
    subtotal_cents: 100000,
    tax_cents: 0,
    discount_cents: 0,
    total_cents: 100000,
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

function renderAt(quoteStatus: QuoteState) {
  getQuoteMock.mockResolvedValue(makeQuote(quoteStatus));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/quotes/00000000-0000-0000-0000-000000000001']}>
        <Routes>
          <Route path="/quotes/:id" element={<QuoteDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('QuoteDetailPage workflow button gating', () => {
  beforeEach(() => {
    getQuoteMock.mockReset();
    useMeMock.mockReset();
  });

  it('shows Submit for draft + sales but not Approve', async () => {
    mockRole('sales');
    renderAt('draft');
    await waitFor(() =>
      expect(screen.getByTestId('quote-number')).toHaveTextContent('Q-0001'),
    );
    expect(screen.getByTestId('action-submit')).toBeInTheDocument();
    expect(screen.queryByTestId('action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-convert')).not.toBeInTheDocument();
  });

  it('shows Approve for submitted + admin but hides write/approve actions for ops (read-only on quotes)', async () => {
    mockRole('org_admin');
    const { unmount } = renderAt('submitted');
    await waitFor(() =>
      expect(screen.getByTestId('quote-number')).toHaveTextContent('Q-0001'),
    );
    expect(screen.getByTestId('action-approve')).toBeInTheDocument();
    expect(screen.getByTestId('action-revise')).toBeInTheDocument();
    expect(screen.getByTestId('action-decline')).toBeInTheDocument();
    unmount();

    // Ops only has quotes.read in the matrix.
    mockRole('ops');
    renderAt('submitted');
    await waitFor(() =>
      expect(screen.getAllByTestId('quote-number')[0]).toHaveTextContent('Q-0001'),
    );
    expect(screen.queryByTestId('action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-revise')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-decline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-duplicate')).not.toBeInTheDocument();
  });

  it('shows Convert to Project only when approved + caller has quotes.convert', async () => {
    mockRole('sales');
    const { unmount } = renderAt('approved');
    await waitFor(() =>
      expect(screen.getByTestId('quote-number')).toHaveTextContent('Q-0001'),
    );
    expect(screen.getByTestId('action-convert')).toBeInTheDocument();
    expect(screen.queryByTestId('action-approve')).not.toBeInTheDocument();
    unmount();

    // Viewer can't convert and shouldn't see workflow actions at all.
    mockRole('viewer');
    renderAt('approved');
    await waitFor(() =>
      expect(screen.getByTestId('quote-number')).toHaveTextContent('Q-0001'),
    );
    expect(screen.queryByTestId('action-convert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-submit')).not.toBeInTheDocument();
  });

  it('hides every state-changing action when status=cancelled', async () => {
    mockRole('org_admin');
    renderAt('cancelled');
    await waitFor(() =>
      expect(screen.getByTestId('quote-number')).toHaveTextContent('Q-0001'),
    );
    expect(screen.queryByTestId('action-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-revise')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-decline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-convert')).not.toBeInTheDocument();
    // Duplicate stays (no state-machine constraint).
    expect(screen.getByTestId('action-duplicate')).toBeInTheDocument();
  });
});

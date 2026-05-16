import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import InvoicesListPage from '../InvoicesListPage';
import type { Invoice, Role } from '@/lib/types';

const listInvoicesMock = vi.fn();
vi.mock('@/lib/services/invoicesService', () => ({
  listInvoices: (filters?: unknown) => listInvoicesMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    invoice_number: 'INV-0001',
    customer_id: '00000000-0000-0000-0000-0000000000bb',
    customer_name_snapshot: 'Acme Co',
    project_id: null,
    quote_id: null,
    status: 'draft',
    payment_status: 'unpaid',
    recurring: null,
    content: null,
    notes: null,
    issue_date: '2026-05-15',
    due_date: '2026-06-15',
    state_changed_at: '2026-05-15T00:00:00.000Z',
    approved: false,
    is_overdue: false,
    converted_from_type: null,
    converted_from_id: null,
    currency_code: 'USD',
    exchange_rate: null,
    subtotal_cents: 100000,
    discount_cents: 0,
    tax_cents: 8750,
    total_cents: 108750,
    paid_cents: 0,
    balance_cents: 108750,
    tax_id: null,
    tax_rate_snapshot: null,
    pdf_path: null,
    external_ref: null,
    sent_at: null,
    paid_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    pending_at: null,
    on_hold_at: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage(initial = '/invoices') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <InvoicesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InvoicesListPage', () => {
  beforeEach(() => {
    listInvoicesMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the invoice rows returned by the service', async () => {
    mockRole('accounting');
    listInvoicesMock.mockResolvedValue({
      items: [
        makeInvoice({ id: 'a', invoice_number: 'INV-001', customer_name_snapshot: 'Acme' }),
        makeInvoice({
          id: 'b',
          invoice_number: 'INV-002',
          customer_name_snapshot: 'Globex',
          total_cents: 50000,
          currency_code: 'EUR',
        }),
      ],
      next_cursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('INV-001')).toBeInTheDocument());
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('INV-002')).toBeInTheDocument();
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('shows the New Invoice link for accounting but hides it for viewer', async () => {
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });

    mockRole('accounting');
    const { unmount } = renderPage();
    await waitFor(() => expect(listInvoicesMock).toHaveBeenCalled());
    expect(screen.getByTestId('new-invoice-link')).toBeInTheDocument();
    unmount();

    listInvoicesMock.mockClear();
    mockRole('viewer');
    renderPage();
    await waitFor(() => expect(listInvoicesMock).toHaveBeenCalled());
    expect(screen.queryByTestId('new-invoice-link')).not.toBeInTheDocument();
  });

  it('applies status from the URL to the service call', async () => {
    mockRole('accounting');
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });

    renderPage('/invoices?status=overdue');

    await waitFor(() => expect(listInvoicesMock).toHaveBeenCalled());
    const args = listInvoicesMock.mock.calls[0]?.[0];
    expect(args).toEqual({ status: 'overdue' });
  });

  it('toggles a status chip — aria-pressed flips on click', async () => {
    mockRole('accounting');
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });

    renderPage();

    await waitFor(() => expect(listInvoicesMock).toHaveBeenCalled());

    const user = userEvent.setup();
    const chip = () => screen.getByTestId('status-chip-paid');
    expect(chip().getAttribute('aria-pressed')).toBe('false');

    await user.click(chip());
    await waitFor(() => expect(chip().getAttribute('aria-pressed')).toBe('true'));
    // Verify the service saw the filter at least once.
    const calls = listInvoicesMock.mock.calls.map((c) => c[0]) as Array<{ status?: string }>;
    expect(calls.some((c) => c?.status === 'paid')).toBe(true);

    // Click again — aria-pressed must clear.
    await user.click(chip());
    await waitFor(() => expect(chip().getAttribute('aria-pressed')).toBe('false'));
  });
});

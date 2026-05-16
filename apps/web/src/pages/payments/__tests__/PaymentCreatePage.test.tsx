import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentCreatePage from '../PaymentCreatePage';
import type { Invoice } from '@/lib/types';

const getInvoiceMock = vi.fn();
const createPaymentMock = vi.fn();
const listInvoicesMock = vi.fn();

vi.mock('@/lib/services/invoicesService', () => ({
  getInvoice: (id: string) => getInvoiceMock(id),
  listInvoices: (filters: unknown) => listInvoicesMock(filters),
}));

vi.mock('@/lib/services/paymentsService', () => ({
  createPayment: (body: unknown) => createPaymentMock(body),
}));

vi.mock('@/lib/services/customersService', () => ({
  listCustomers: () => Promise.resolve({ items: [], next_cursor: null }),
}));

vi.mock('@/lib/services/paymentMethodsService', () => ({
  listPaymentMethods: () => Promise.resolve({ items: [], next_cursor: null }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    invoice_number: 'INV-0001',
    customer_id: '22222222-2222-2222-2222-222222222222',
    customer_name_snapshot: 'Acme Co',
    project_id: null,
    quote_id: null,
    status: 'sent',
    payment_status: 'unpaid',
    recurring: null,
    content: null,
    notes: null,
    issue_date: '2026-05-01',
    due_date: '2026-06-01',
    state_changed_at: '2026-05-01T00:00:00.000Z',
    approved: true,
    is_overdue: false,
    converted_from_type: null,
    converted_from_id: null,
    currency_code: 'EUR',
    exchange_rate: null,
    subtotal_cents: 100000,
    discount_cents: 0,
    tax_cents: 0,
    total_cents: 100000,
    paid_cents: 0,
    balance_cents: 100000,
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
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderAt(initial: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/payments/new" element={<PaymentCreatePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentCreatePage', () => {
  beforeEach(() => {
    getInvoiceMock.mockReset();
    createPaymentMock.mockReset();
    listInvoicesMock.mockReset();
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });
  });

  it('pins currency to the invoice currency_code when prefilled (read-only)', async () => {
    getInvoiceMock.mockResolvedValue(makeInvoice({ currency_code: 'EUR' }));
    renderAt('/payments/new?invoice_id=11111111-1111-1111-1111-111111111111');

    // Wait until the prefill useEffect has pinned the currency to EUR.
    await waitFor(() => {
      const ci = screen.getByTestId('currency-readonly') as HTMLInputElement;
      expect(ci.value).toBe('EUR');
    });
    const currencyInput = screen.getByTestId('currency-readonly') as HTMLInputElement;
    expect(currencyInput.readOnly).toBe(true);
  });

  it('rejects an amount that exceeds invoice.balance_cents', async () => {
    // Provide one payable invoice via the InvoicePicker (skip the prefill path)
    // so the test is independent of the prefill useEffect timing.
    const inv = makeInvoice({ balance_cents: 50000, currency_code: 'USD' });
    listInvoicesMock.mockResolvedValue({ items: [inv], next_cursor: null });
    renderAt('/payments/new');

    // Wait until the picker's option list contains our INV-0001.
    await screen.findByText(/INV-0001/);

    // Select the invoice via the picker — that path sets selectedInvoice
    // synchronously from the local items list.
    fireEvent.change(screen.getByTestId('invoice-picker'), { target: { value: inv.id } });

    // Wait until currency pin reflects the invoice currency.
    await waitFor(() => {
      const ci = screen.getByTestId('currency-readonly') as HTMLInputElement;
      expect(ci.value).toBe('USD');
    });
    // Confirm selectedInvoice state by the Balance footer.
    await screen.findByText(/Balance:/);

    // Type an over-balance value into the money input.
    const moneyInput = screen.getByLabelText('Payment amount') as HTMLInputElement;
    fireEvent.change(moneyInput, { target: { value: '999.99' } });
    fireEvent.blur(moneyInput);

    expect(await screen.findByTestId('over-balance-error')).toBeInTheDocument();
    expect(createPaymentMock).not.toHaveBeenCalled();
  });
});

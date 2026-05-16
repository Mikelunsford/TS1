import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InvoicePicker } from '../InvoicePicker';
import type { Invoice } from '@/lib/types';

const listInvoicesMock = vi.fn();
vi.mock('@/lib/services/invoicesService', () => ({
  listInvoices: (filters: unknown) => listInvoicesMock(filters),
}));

function makeInv(overrides: Partial<Invoice>): Invoice {
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
    currency_code: 'USD',
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

function renderPicker(onSelect: (i: Invoice | null) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <InvoicePicker value="" onSelect={onSelect} data-testid="picker" />
    </QueryClientProvider>,
  );
}

describe('InvoicePicker', () => {
  it('passes typed search to listInvoices', async () => {
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPicker(() => undefined);
    fireEvent.change(screen.getByTestId('picker-search'), { target: { value: 'INV-99' } });
    await waitFor(() => {
      const lastCall = listInvoicesMock.mock.calls[listInvoicesMock.mock.calls.length - 1]?.[0];
      expect(lastCall).toMatchObject({ q: 'INV-99' });
    });
  });

  it('filters out non-payable statuses by default', async () => {
    listInvoicesMock.mockResolvedValue({
      items: [
        makeInv({ id: 'a', invoice_number: 'INV-A', status: 'sent' }),
        makeInv({ id: 'b', invoice_number: 'INV-B', status: 'draft' }),
        makeInv({ id: 'c', invoice_number: 'INV-C', status: 'paid' }),
        makeInv({ id: 'd', invoice_number: 'INV-D', status: 'overdue' }),
      ],
      next_cursor: null,
    });
    renderPicker(() => undefined);
    await waitFor(() => expect(screen.getByText(/INV-A/)).toBeInTheDocument());
    expect(screen.queryByText(/INV-B/)).not.toBeInTheDocument();
    expect(screen.queryByText(/INV-C/)).not.toBeInTheDocument();
    expect(screen.getByText(/INV-D/)).toBeInTheDocument();
  });

  it('calls onSelect with the full Invoice row when an option is picked', async () => {
    const inv = makeInv({ id: 'a', invoice_number: 'INV-A', status: 'sent' });
    listInvoicesMock.mockResolvedValue({ items: [inv], next_cursor: null });
    const onSelect = vi.fn();
    renderPicker(onSelect);
    await waitFor(() => expect(screen.getByText(/INV-A/)).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('picker'), { target: { value: 'a' } });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a', invoice_number: 'INV-A' }));
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ApplyCreditDialog } from '../ApplyCreditDialog';
import type { Invoice } from '@/lib/types';

const listInvoicesMock = vi.fn();
vi.mock('@/lib/services/invoicesService', () => ({
  listInvoices: (filters: unknown) => listInvoicesMock(filters),
}));

function makeInv(overrides: Partial<Invoice> = {}): Invoice {
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
    subtotal_cents: 200000,
    discount_cents: 0,
    tax_cents: 0,
    total_cents: 200000,
    paid_cents: 0,
    balance_cents: 200000,
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

function renderDialog(remainingCents: number) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ApplyCreditDialog
        open={true}
        currency="USD"
        remainingCents={remainingCents}
        onCancel={onCancel}
        onConfirm={onConfirm}
      />
    </QueryClientProvider>,
  );
  return { onConfirm, onCancel };
}

describe('ApplyCreditDialog', () => {
  it('requires invoice + valid amount before confirm is enabled', async () => {
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });
    const { onConfirm } = renderDialog(10000);

    const confirm = screen.getByTestId('apply-confirm');
    // Initially no invoice picked, so confirm should be disabled.
    expect(confirm).toBeDisabled();
    fireEvent.submit(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects amount > remaining', async () => {
    const inv = makeInv({ id: 'a', invoice_number: 'INV-A' });
    listInvoicesMock.mockResolvedValue({ items: [inv], next_cursor: null });
    const { onConfirm } = renderDialog(5000);
    await waitFor(() => expect(screen.getByText(/INV-A/)).toBeInTheDocument());

    // Pick the invoice.
    fireEvent.change(screen.getByTestId('apply-invoice-picker'), { target: { value: 'a' } });

    // Bump amount above remaining.
    const moneyInput = screen.getByLabelText('Apply amount') as HTMLInputElement;
    fireEvent.change(moneyInput, { target: { value: '500.00' } });
    fireEvent.blur(moneyInput);

    await waitFor(() =>
      expect(screen.getByTestId('apply-amount-error')).toBeInTheDocument(),
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('rejects amount = 0', async () => {
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });
    const { onConfirm } = renderDialog(0);
    const confirm = screen.getByTestId('apply-confirm');
    expect(confirm).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

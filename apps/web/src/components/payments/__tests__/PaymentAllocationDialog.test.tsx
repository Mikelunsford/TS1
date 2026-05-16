/**
 * PaymentAllocationDialog — headroom math + sum-not-exceeds-remaining
 * validation. The legacy-1:1 path is tested via the "no existing
 * allocations" branch which surfaces the warning + disables submit.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PaymentAllocationDialog } from '../PaymentAllocationDialog';
import type { Payment, PaymentAllocation } from '@/lib/types';

const listMock = vi.fn();
const allocateMock = vi.fn();
vi.mock('@/lib/services/paymentAllocationsService', () => ({
  listPaymentAllocations: () => listMock(),
  allocatePayment: (id: string, body: unknown) => allocateMock(id, body),
}));

const listInvoicesMock = vi.fn();
vi.mock('@/lib/services/invoicesService', () => ({
  listInvoices: (filters?: unknown) => listInvoicesMock(filters),
}));

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
    org_id: '00000000-0000-0000-0000-0000000000ff',
    payment_number: 'PAY-0001',
    customer_id: '00000000-0000-0000-0000-0000000000cc',
    invoice_id: '00000000-0000-0000-0000-0000000000bb',
    payment_method_id: null,
    paid_at: '2026-05-16T00:00:00.000Z',
    amount_cents: 100_00,
    currency_code: 'USD',
    exchange_rate: null,
    reference: null,
    description: null,
    external_ref: null,
    cleared_at: null,
    voided_at: null,
    void_reason: null,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function makeAlloc(overrides: Partial<PaymentAllocation> = {}): PaymentAllocation {
  return {
    id: '00000000-0000-0000-0000-0000000000a1',
    org_id: '00000000-0000-0000-0000-0000000000ff',
    payment_id: '00000000-0000-0000-0000-0000000000aa',
    invoice_id: '00000000-0000-0000-0000-0000000000b1',
    amount_cents: 40_00,
    notes: null,
    created_at: '2026-05-16T00:00:00.000Z',
    created_by: null,
    updated_at: '2026-05-16T00:00:00.000Z',
    updated_by: null,
    deleted_at: null,
    ...overrides,
  };
}

function renderDialog(payment: Payment) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PaymentAllocationDialog payment={payment} open onClose={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentAllocationDialog', () => {
  beforeEach(() => {
    listMock.mockReset();
    allocateMock.mockReset();
    listInvoicesMock.mockReset();
    listInvoicesMock.mockResolvedValue({ items: [], next_cursor: null });
  });

  it('warns when no allocations exist (legacy 1:1 holds full amount)', async () => {
    listMock.mockResolvedValue([]);
    renderDialog(makePayment());
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.getByTestId('alloc-legacy-warning')).toBeInTheDocument();
    const submit = screen.getByTestId('alloc-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('computes remaining headroom correctly when prior allocations exist', async () => {
    listMock.mockResolvedValue([makeAlloc({ amount_cents: 40_00 })]);
    renderDialog(makePayment({ amount_cents: 100_00 }));
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    // payment 100.00; existing 40.00; legacy 0; remaining = 60.00
    const remaining = await screen.findByTestId('alloc-remaining');
    expect(remaining.textContent ?? '').toMatch(/60/);
  });

  it('disables submit when allocations are incomplete', async () => {
    listMock.mockResolvedValue([makeAlloc({ amount_cents: 40_00 })]);
    renderDialog(makePayment({ amount_cents: 100_00 }));
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const submit = (await screen.findByTestId('alloc-submit')) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });
});

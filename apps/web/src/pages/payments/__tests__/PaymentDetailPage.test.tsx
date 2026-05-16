import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PaymentDetailPage from '../PaymentDetailPage';
import type { Payment, Role } from '@/lib/types';

const getPaymentMock = vi.fn();
const voidPaymentMock = vi.fn();

vi.mock('@/lib/services/paymentsService', () => ({
  getPayment: (id: string) => getPaymentMock(id),
  updatePayment: vi.fn(),
  voidPayment: (id: string, body: unknown) => voidPaymentMock(id, body),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '33333333-3333-3333-3333-333333333333',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    payment_number: 'PAY-0001',
    customer_id: '22222222-2222-2222-2222-222222222222',
    invoice_id: '11111111-1111-1111-1111-111111111111',
    payment_method_id: null,
    paid_at: '2026-05-15T00:00:00.000Z',
    amount_cents: 50000,
    currency_code: 'USD',
    exchange_rate: null,
    reference: null,
    description: null,
    external_ref: null,
    cleared_at: null,
    voided_at: null,
    void_reason: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/payments/33333333-3333-3333-3333-333333333333']}>
        <Routes>
          <Route path="/payments/:id" element={<PaymentDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PaymentDetailPage void gating', () => {
  beforeEach(() => {
    getPaymentMock.mockReset();
    voidPaymentMock.mockReset();
    useMeMock.mockReset();
  });

  it('shows Void button for accounting on a non-voided payment', async () => {
    mockRole('accounting');
    getPaymentMock.mockResolvedValue(makePayment());
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'PAY-0001' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('payment-void')).toBeInTheDocument();
  });

  it('hides Void on an already-voided payment', async () => {
    mockRole('accounting');
    getPaymentMock.mockResolvedValue(makePayment({
      voided_at: '2026-05-16T00:00:00.000Z',
      void_reason: 'duplicate entry',
    }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'PAY-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('payment-void')).not.toBeInTheDocument();
  });

  it('hides Void for sales (lacks payments.void cap)', async () => {
    mockRole('sales');
    getPaymentMock.mockResolvedValue(makePayment());
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'PAY-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('payment-void')).not.toBeInTheDocument();
  });

  it('blocks void submit when reason is empty', async () => {
    mockRole('accounting');
    getPaymentMock.mockResolvedValue(makePayment());
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'PAY-0001' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('payment-void'));
    const confirm = await screen.findByTestId('void-confirm');
    expect(confirm).toBeDisabled();
    expect(voidPaymentMock).not.toHaveBeenCalled();
  });
});

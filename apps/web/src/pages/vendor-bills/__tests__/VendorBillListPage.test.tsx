import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VendorBillListPage from '../VendorBillListPage';
import type { Role, VendorBill } from '@/lib/types';

const listMock = vi.fn();
vi.mock('@/lib/services/vendorBillsService', () => ({
  listVendorBills: (filters?: unknown) => listMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeBill(overrides: Partial<VendorBill> = {}): VendorBill {
  return {
    id: '1',
    org_id: 'org',
    bill_number: 'VB-0001',
    vendor_id: 'v1',
    po_id: null,
    vendor_ref: null,
    status: 'draft',
    issue_date: '2026-05-16',
    due_date: '2026-06-16',
    currency_code: 'USD',
    subtotal_cents: 100000,
    tax_cents: 0,
    total_cents: 100000,
    paid_cents: 0,
    balance_cents: 100000,
    notes: null,
    approved_at: null,
    approved_by: null,
    paid_at: null,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage(initial = '/vendor-bills') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <VendorBillListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorBillListPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the 7-state chip set', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    for (const s of ['draft', 'pending', 'approved', 'partially_paid', 'paid', 'overdue', 'cancelled']) {
      expect(screen.getByTestId(`status-chip-${s}`)).toBeInTheDocument();
    }
  });

  it('renders vendor bill rows', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({
      items: [makeBill({ id: 'a', bill_number: 'VB-001' })],
      next_cursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('VB-001')).toBeInTheDocument());
  });
});

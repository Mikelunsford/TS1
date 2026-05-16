import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PurchaseOrderListPage from '../PurchaseOrderListPage';
import type { PurchaseOrder, Role } from '@/lib/types';

const listMock = vi.fn();
vi.mock('@/lib/services/purchaseOrdersService', () => ({
  listPurchaseOrders: (filters?: unknown) => listMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makePO(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: '1',
    org_id: 'org',
    po_number: 'PO-0001',
    vendor_id: 'v1',
    project_id: null,
    status: 'draft',
    issue_date: '2026-05-16',
    expected_date: null,
    currency_code: 'USD',
    subtotal_cents: 100000,
    tax_cents: 0,
    shipping_cents: 0,
    total_cents: 100000,
    notes: null,
    state_changed_at: '2026-05-16T00:00:00.000Z',
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage(initial = '/purchase-orders') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <PurchaseOrderListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseOrderListPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders PO rows + uses the partial_received chip spelling', async () => {
    mockRole('ops');
    listMock.mockResolvedValue({
      items: [makePO({ id: 'a', po_number: 'PO-001', status: 'partial_received' })],
      next_cursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('PO-001')).toBeInTheDocument());
    // Constitutional invariant: state spelling is partial_received (one r).
    expect(screen.getByTestId('status-chip-partial_received')).toBeInTheDocument();
  });

  it('toggles a status chip — aria-pressed flips on click', async () => {
    mockRole('ops');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());

    const user = userEvent.setup();
    const chip = () => screen.getByTestId('status-chip-approved');
    expect(chip().getAttribute('aria-pressed')).toBe('false');
    await user.click(chip());
    await waitFor(() => expect(chip().getAttribute('aria-pressed')).toBe('true'));
  });
});

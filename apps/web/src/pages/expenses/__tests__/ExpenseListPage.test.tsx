import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ExpenseListPage from '../ExpenseListPage';
import MyExpensesPage from '../MyExpensesPage';
import type { Expense, Role } from '@/lib/types';

const listMock = vi.fn();
vi.mock('@/lib/services/expensesService', () => ({
  listExpenses: (filters?: unknown) => listMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: '1',
    org_id: 'org',
    expense_number: 'EXP-0001',
    category_id: null,
    vendor_id: null,
    project_id: null,
    account_id: null,
    spent_at: '2026-05-16',
    description: 'Coffee',
    status: 'draft',
    currency_code: 'USD',
    amount_cents: 1000,
    tax_cents: 100,
    tax_id: null,
    total_cents: 1100,
    paid_at: null,
    receipt_url: null,
    notes: null,
    submitted_by: null,
    approved_by: null,
    approved_at: null,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderList(initial = '/expenses') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ExpenseListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderMy() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/expenses/my']}>
        <MyExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExpenseListPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the 6-state chip set (NO cancelled)', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    renderList();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    for (const s of ['draft', 'submitted', 'approved', 'rejected', 'reimbursed', 'paid']) {
      expect(screen.getByTestId(`status-chip-${s}`)).toBeInTheDocument();
    }
    expect(screen.queryByTestId('status-chip-cancelled')).not.toBeInTheDocument();
  });

  it('MyExpensesPage forwards me=true to the service', async () => {
    mockRole('sales');
    listMock.mockResolvedValue({ items: [makeExpense()], next_cursor: null });
    renderMy();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    const args = listMock.mock.calls[0]?.[0] as { me?: boolean } | undefined;
    expect(args?.me).toBe(true);
  });

  it('renders the expense rows returned by the service', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({
      items: [makeExpense({ id: 'a', expense_number: 'EXP-001', description: 'Lunch' })],
      next_cursor: null,
    });
    renderList();
    await waitFor(() => expect(screen.getByText('EXP-001')).toBeInTheDocument());
    expect(screen.getByText('Lunch')).toBeInTheDocument();
  });
});

/**
 * AccountListPage smoke + is_system flag visibility.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AccountListPage from '../AccountListPage';
import type { ChartOfAccount, Role } from '@/lib/types';

const listMock = vi.fn();
vi.mock('@/lib/services/chartOfAccountsService', () => ({
  listChartOfAccounts: (filters?: unknown) => listMock(filters),
  archiveChartOfAccount: vi.fn(),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function makeAccount(overrides: Partial<ChartOfAccount> = {}): ChartOfAccount {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    account_code: '1000',
    label: 'Cash',
    account_type: 'asset',
    parent_id: null,
    currency_code: 'USD',
    description: null,
    is_active: true,
    is_system: false,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/finance/accounts']}>
        <AccountListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AccountListPage', () => {
  beforeEach(() => {
    listMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the 6 account-type chips', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    for (const t of ['asset', 'liability', 'equity', 'revenue', 'expense', 'cogs']) {
      expect(screen.getByTestId(`type-chip-${t}`)).toBeInTheDocument();
    }
  });

  it('flags system-seeded rows with a "System" badge and hides their Archive button', async () => {
    mockRole('accounting');
    const systemAccount = makeAccount({
      id: 'sys-1',
      account_code: '1010',
      label: 'Retained earnings',
      is_system: true,
    });
    const userAccount = makeAccount({
      id: 'usr-1',
      account_code: '2000',
      label: 'Custom liability',
      account_type: 'liability',
      is_system: false,
    });
    listMock.mockResolvedValue({ items: [systemAccount, userAccount], next_cursor: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('Retained earnings')).toBeInTheDocument());
    expect(screen.getByTestId('account-sys-1-system-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('account-sys-1-archive')).not.toBeInTheDocument();
    expect(screen.getByTestId('account-usr-1-archive')).toBeInTheDocument();
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VendorListPage from '../VendorListPage';
import type { Role, Vendor } from '@/lib/types';

const listVendorsMock = vi.fn();
vi.mock('@/lib/services/vendorsService', () => ({
  listVendors: (filters?: unknown) => listVendorsMock(filters),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function makeVendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: '22222222-2222-2222-2222-222222222222',
    name: 'Acme Supplies',
    legal_name: null,
    email: null,
    phone: null,
    website: null,
    tax_id: null,
    currency_code: 'USD',
    payment_terms_days: 30,
    billing_address: {},
    external_ref: null,
    notes: null,
    is_active: true,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    deleted_at: null,
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderPage(initial = '/vendors') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <VendorListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('VendorListPage', () => {
  beforeEach(() => {
    listVendorsMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders vendor rows returned by the service', async () => {
    mockRole('org_admin');
    listVendorsMock.mockResolvedValue({
      items: [
        makeVendor({ id: 'a', name: 'Acme' }),
        makeVendor({ id: 'b', name: 'Globex' }),
      ],
      next_cursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Acme')).toBeInTheDocument());
    expect(screen.getByText('Globex')).toBeInTheDocument();
  });

  it('shows New vendor link for accounting, hides for viewer', async () => {
    listVendorsMock.mockResolvedValue({ items: [], next_cursor: null });
    mockRole('org_admin');
    const { unmount } = renderPage();
    expect(await screen.findByTestId('new-vendor-link')).toBeInTheDocument();
    unmount();

    listVendorsMock.mockClear();
    mockRole('viewer');
    renderPage();
    await waitFor(() => expect(listVendorsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('new-vendor-link')).not.toBeInTheDocument();
  });
});

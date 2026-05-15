import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ItemsListPage from './ItemsListPage';
import type { Item } from '@/lib/types';

const listItemsMock = vi.fn();
vi.mock('@/lib/services/itemsService', () => ({
  listItems: (filters?: unknown) => listItemsMock(filters),
}));
// Avoid the inner picker doing its own fetch; it's not under test here.
vi.mock('@/components/inventory/ItemCategoryPicker', () => ({
  ItemCategoryPicker: () => null,
}));

function makeItem(overrides: Partial<Item> = {}): Item {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    item_code: 'SKU-001',
    description: 'Widget',
    category: null,
    category_id: null,
    item_kind: 'material',
    markup_pct: null,
    unit_price_cents: 1999,
    unit_cost_cents: 1000,
    currency_code: 'USD',
    unit_id: null,
    tax_id: null,
    is_inventoried: false,
    reorder_point: null,
    is_active: true,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(initial = '/items') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ItemsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ItemsListPage', () => {
  beforeEach(() => {
    listItemsMock.mockReset();
  });

  it('renders items returned by the service with their formatted price', async () => {
    listItemsMock.mockResolvedValue({
      items: [
        makeItem({ id: 'a', item_code: 'SKU-A', description: 'Alpha', unit_price_cents: 1999 }),
        makeItem({
          id: 'b',
          item_code: 'SKU-B',
          description: 'Beta',
          unit_price_cents: 50000,
          currency_code: 'EUR',
        }),
      ],
      next_cursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('SKU-A')).toBeInTheDocument());
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('SKU-B')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    // USD price for the first item.
    expect(screen.getByText(/19\.99/)).toBeInTheDocument();
    // EUR price for the second item (Intl format varies by locale; digits are stable).
    expect(screen.getByText(/500\.00|500,00/)).toBeInTheDocument();
  });

  it('passes is_active=true by default and drops it when archived toggle is on', async () => {
    listItemsMock.mockResolvedValue({ items: [], next_cursor: null });

    renderPage('/items');
    await waitFor(() => expect(listItemsMock).toHaveBeenCalled());
    const firstCall = listItemsMock.mock.calls[0]?.[0];
    expect(firstCall).toEqual({ is_active: true });

    listItemsMock.mockClear();
    renderPage('/items?archived=1');
    await waitFor(() => expect(listItemsMock).toHaveBeenCalled());
    const archivedCall = listItemsMock.mock.calls[0]?.[0];
    expect(archivedCall).toEqual({});
  });

  it('renders the empty state when the service returns no items', async () => {
    listItemsMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('No items found')).toBeInTheDocument());
  });
});

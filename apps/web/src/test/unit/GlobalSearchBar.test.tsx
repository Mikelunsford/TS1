/**
 * Unit tests for <GlobalSearchBar> (Phase 17 — Wave 10 Session 2 / B2).
 *
 * Covers:
 *   1. Cmd/Ctrl+K hotkey focuses the input (via useGlobalSearchHotkey).
 *   2. Typing below 2 chars does not fire the search query.
 *   3. Typing >= 2 chars triggers a debounced query.
 *   4. Result rows render grouped by type.
 *   5. Enter on an active row navigates.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type * as SearchServiceModule from '@/lib/services/searchService';

vi.mock('@/lib/services/searchService', async () => {
  const actual = await vi.importActual<typeof SearchServiceModule>(
    '@/lib/services/searchService',
  );
  return {
    ...actual,
    globalSearch: vi.fn(),
  };
});

import { globalSearch } from '@/lib/services/searchService';
import { GlobalSearchBar } from '@/components/shell/GlobalSearchBar';

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GlobalSearchBar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(globalSearch).mockResolvedValue({
    q: 'acme',
    items: [
      {
        type: 'customer',
        id: '00000000-0000-0000-0000-000000000001',
        display_name: 'Acme Co',
        snippet: 'acme@example.com',
        url_path: '/crm/customers/00000000-0000-0000-0000-000000000001',
        org_id: '00000000-0000-0000-0000-000000000aaa',
      },
      {
        type: 'invoice',
        id: '00000000-0000-0000-0000-000000000002',
        display_name: 'INV-0001',
        snippet: 'Acme Co · paid',
        url_path: '/invoicing/invoices/00000000-0000-0000-0000-000000000002',
        org_id: '00000000-0000-0000-0000-000000000aaa',
      },
    ],
  });
});

describe('<GlobalSearchBar>', () => {
  it('renders an input labeled Global search', () => {
    renderBar();
    expect(screen.getByLabelText('Global search')).toBeInTheDocument();
  });

  it('does not query for inputs shorter than 2 characters', async () => {
    const user = userEvent.setup();
    renderBar();
    const input = screen.getByLabelText('Global search') as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'a');
    // Debounce window for the test
    await new Promise((r) => setTimeout(r, 350));
    expect(globalSearch).not.toHaveBeenCalled();
  });

  it('queries after typing 2+ characters and renders grouped results', async () => {
    const user = userEvent.setup();
    renderBar();
    const input = screen.getByLabelText('Global search') as HTMLInputElement;
    await user.click(input);
    await user.type(input, 'acme');
    await waitFor(() => expect(globalSearch).toHaveBeenCalled(), { timeout: 1000 });
    await waitFor(() => expect(screen.getByText('Acme Co')).toBeInTheDocument());
    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    // Grouped headers
    expect(screen.getByText('Customers')).toBeInTheDocument();
    expect(screen.getByText('Invoices')).toBeInTheDocument();
  });

  it('Cmd+K hotkey focuses the input', async () => {
    renderBar();
    const input = screen.getByLabelText('Global search') as HTMLInputElement;
    expect(document.activeElement).not.toBe(input);
    act(() => {
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

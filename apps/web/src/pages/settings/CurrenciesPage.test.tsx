/**
 * CurrenciesPage tests — verifies the matrix renders all global currencies
 * and toggling `is_active` calls the service with the next boolean.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import CurrenciesPage from './CurrenciesPage';
import type { Currency } from '@/lib/types';

const listCurrenciesMock = vi.fn();
const updateCurrencyMock = vi.fn();

vi.mock('@/lib/services/currenciesService', () => ({
  listCurrencies: (...a: unknown[]) => listCurrenciesMock(...a),
  updateCurrency: (...a: unknown[]) => updateCurrencyMock(...a),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function currency(overrides: Partial<Currency> = {}): Currency {
  return {
    code: 'USD',
    label: 'US Dollar',
    symbol: '$',
    symbol_position: 'before',
    decimal_sep: '.',
    thousand_sep: ',',
    cent_precision: 2,
    zero_format: false,
    is_active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CurrenciesPage />
    </QueryClientProvider>,
  );
}

describe('CurrenciesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listCurrenciesMock.mockResolvedValue({
      items: [
        currency({ code: 'USD', is_active: true }),
        currency({ code: 'EUR', label: 'Euro', symbol: '€', is_active: false }),
      ],
      next_cursor: null,
    });
    updateCurrencyMock.mockResolvedValue(currency({ code: 'EUR', is_active: true }));
  });

  it('renders all global currency rows', async () => {
    renderWithClient();
    await waitFor(() => {
      expect(screen.getByText('US Dollar')).toBeInTheDocument();
      expect(screen.getByText('Euro')).toBeInTheDocument();
    });
  });

  it('toggling is_active calls updateCurrency with the next boolean', async () => {
    renderWithClient();
    await waitFor(() => {
      expect(screen.getByTestId('currency-toggle-EUR')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('currency-toggle-EUR'));
    await waitFor(() => {
      expect(updateCurrencyMock).toHaveBeenCalledWith('EUR', { is_active: true });
    });
  });
});

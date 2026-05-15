/**
 * TaxesPage tests — verifies the list renders and create form happy path
 * sends the wire-format decimal rate (not the percent).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import TaxesPage from './TaxesPage';
import type { Tax } from '@/lib/types';

const listTaxesMock = vi.fn();
const createTaxMock = vi.fn();
const archiveTaxMock = vi.fn();
const updateTaxMock = vi.fn();

vi.mock('@/lib/services/taxesService', () => ({
  listTaxes: (...a: unknown[]) => listTaxesMock(...a),
  createTax: (...a: unknown[]) => createTaxMock(...a),
  archiveTax: (...a: unknown[]) => archiveTaxMock(...a),
  updateTax: (...a: unknown[]) => updateTaxMock(...a),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function tax(overrides: Partial<Tax> = {}): Tax {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    code: 'CA-SF',
    label: 'San Francisco Sales Tax',
    rate: 0.0875,
    jurisdiction: 'CA-SF',
    is_compound: false,
    is_inclusive: false,
    is_default: false,
    is_active: true,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
    ...overrides,
  };
}

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaxesPage />
    </QueryClientProvider>,
  );
}

describe('TaxesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listTaxesMock.mockResolvedValue({ items: [tax()], next_cursor: null });
    createTaxMock.mockResolvedValue(tax({ id: '22222222-2222-2222-2222-222222222222' }));
  });

  it('renders rates as percentages (0.0875 -> 8.75%)', async () => {
    renderWithClient();
    await waitFor(() => {
      expect(screen.getByText('8.75%')).toBeInTheDocument();
    });
    expect(screen.getByText('San Francisco Sales Tax')).toBeInTheDocument();
  });

  it('submits create form with decimal rate (8.75% -> 0.0875)', async () => {
    renderWithClient();
    await waitFor(() => {
      expect(screen.getByText('San Francisco Sales Tax')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByTestId('tax-code-input'), { target: { value: 'NY' } });
    fireEvent.change(screen.getByTestId('tax-label-input'), {
      target: { value: 'New York Sales Tax' },
    });
    fireEvent.change(screen.getByTestId('tax-rate-input'), { target: { value: '8.875' } });
    fireEvent.click(screen.getByTestId('tax-submit'));

    await waitFor(() => {
      expect(createTaxMock).toHaveBeenCalled();
    });
    const callArg = createTaxMock.mock.calls[0]?.[0];
    expect(callArg.code).toBe('NY');
    expect(callArg.label).toBe('New York Sales Tax');
    // The wire format is decimal 0..1.
    expect(callArg.rate).toBeCloseTo(0.08875, 6);
  });
});

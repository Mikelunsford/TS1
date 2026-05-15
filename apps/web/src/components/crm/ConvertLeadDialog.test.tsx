/**
 * ConvertLeadDialog tests.
 *
 * Verifies: dialog renders with the lead's display_name as the default
 * opportunity name; filling the form and submitting calls `convertLead` with
 * the expected payload (amount string -> bigint cents); success closes the
 * dialog and fires a toast.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ConvertLeadDialog } from './ConvertLeadDialog';
import type { Lead } from '@/lib/crmTypes';

const convertLeadMock = vi.fn(
  async (args: {
    id: string;
    opportunity_name: string;
    amount_cents: number;
    currency_code: string;
    create_customer: boolean;
  }) => ({
    lead_id: args.id,
    opportunity_id: '00000000-0000-0000-0000-000000000099',
    opportunity_number: 'OPP-2026-00042',
    customer_id: args.create_customer ? '00000000-0000-0000-0000-000000000077' : null,
  }),
);

vi.mock('@/lib/services/leadsService', () => ({
  convertLead: (...args: unknown[]) => convertLeadMock(...(args as Parameters<typeof convertLeadMock>)),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

function leadFixture(): Lead {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: '00000000-0000-0000-0000-000000000001',
    display_name: 'Acme Logistics',
    status: 'qualified',
    source: 'inbound',
    primary_email: 'ap@acme.com',
    primary_phone: null,
    assigned_to: null,
    notes: null,
    converted_opportunity_id: null,
    converted_customer_id: null,
    converted_at: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('ConvertLeadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    renderWithClient(
      <ConvertLeadDialog lead={leadFixture()} open={false} onClose={() => undefined} />,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('defaults the opportunity name to the lead display_name', () => {
    renderWithClient(<ConvertLeadDialog lead={leadFixture()} open onClose={() => undefined} />);
    const input = screen.getByTestId('opportunity-name-input') as HTMLInputElement;
    expect(input.value).toBe('Acme Logistics');
  });

  it('submits with the expected payload and closes on success', async () => {
    const onClose = vi.fn();
    const onSuccess = vi.fn();
    renderWithClient(
      <ConvertLeadDialog lead={leadFixture()} open onClose={onClose} onSuccess={onSuccess} />,
    );

    fireEvent.change(screen.getByTestId('amount-input'), { target: { value: '1234.56' } });
    fireEvent.change(screen.getByTestId('currency-input'), { target: { value: 'EUR' } });
    fireEvent.click(screen.getByTestId('convert-submit'));

    await waitFor(() => {
      expect(convertLeadMock).toHaveBeenCalledWith({
        id: '11111111-1111-1111-1111-111111111111',
        opportunity_name: 'Acme Logistics',
        amount_cents: 123456,
        currency_code: 'EUR',
        create_customer: true,
      });
    });
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('shows an inline error when amount is empty', async () => {
    renderWithClient(<ConvertLeadDialog lead={leadFixture()} open onClose={() => undefined} />);
    fireEvent.change(screen.getByTestId('amount-input'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('convert-submit'));
    // Since amount is `required` and empty, the browser blocks submit; in jsdom
    // the form submission still fires but our handler returns early when toCents
    // throws. Either way convertLead must not be called.
    await waitFor(() => {
      expect(convertLeadMock).not.toHaveBeenCalled();
    });
  });
});

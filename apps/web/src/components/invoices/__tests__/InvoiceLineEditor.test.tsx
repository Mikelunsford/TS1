/**
 * InvoiceLineEditor tests — replace bulk POST shape + taxTotalCents preview
 * + the read-only / editable gate. Drag-reorder is exercised by asserting
 * that the bulk-replace body uses the current line order and position.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { InvoiceLineEditor } from '../InvoiceLineEditor';
import type { InvoiceLine } from '@/lib/types';

const listInvoiceLinesMock = vi.fn();
const replaceInvoiceLinesMock = vi.fn();
const appendInvoiceLineMock = vi.fn();
const patchInvoiceLineMock = vi.fn();
const deleteInvoiceLineMock = vi.fn();
const reorderInvoiceLinesMock = vi.fn();

vi.mock('@/lib/services/invoiceLineItemsService', () => ({
  listInvoiceLines: (id: string) => listInvoiceLinesMock(id),
  replaceInvoiceLines: (id: string, body: unknown) => replaceInvoiceLinesMock(id, body),
  appendInvoiceLine: (id: string, body: unknown) => appendInvoiceLineMock(id, body),
  patchInvoiceLine: (id: string, lid: string, body: unknown) =>
    patchInvoiceLineMock(id, lid, body),
  deleteInvoiceLine: (id: string, lid: string) => deleteInvoiceLineMock(id, lid),
  reorderInvoiceLines: (id: string, body: unknown) => reorderInvoiceLinesMock(id, body),
}));

vi.mock('@/lib/services/itemsService', () => ({
  listItems: () => Promise.resolve({ items: [], next_cursor: null }),
}));

function makeLine(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    invoice_id: '00000000-0000-0000-0000-0000000000ff',
    invoice_version_id: null,
    item_id: null,
    description: 'Widget A',
    quantity: 2,
    unit: 'ea',
    unit_price_cents: 5000,
    unit_cost_cents: 0,
    discount_cents: 0,
    tax_id: null,
    tax_rate_snapshot: 0.0875,
    tax_amount_cents: 875,
    line_total_cents: 10000,
    position: 0,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderEditor(editable: boolean) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <InvoiceLineEditor
        invoiceId="00000000-0000-0000-0000-0000000000ff"
        currency="USD"
        editable={editable}
      />
    </QueryClientProvider>,
  );
}

describe('InvoiceLineEditor', () => {
  beforeEach(() => {
    listInvoiceLinesMock.mockReset();
    replaceInvoiceLinesMock.mockReset();
    appendInvoiceLineMock.mockReset();
    patchInvoiceLineMock.mockReset();
    deleteInvoiceLineMock.mockReset();
    reorderInvoiceLinesMock.mockReset();
  });

  it('shows the taxTotalCents preview matching the BE half-even helper', async () => {
    // qty=2, unit_price=5000, discount=0, tax_rate=0.0875 ⇒
    //   line_total = 10000, line_tax = roundHalfEven(10000 * 0.0875) = 875
    listInvoiceLinesMock.mockResolvedValue({
      items: [makeLine()],
      next_cursor: null,
    });

    renderEditor(true);

    const preview = await screen.findByTestId('line-totals-preview');
    expect(preview).toHaveTextContent(/Subtotal preview/);
    // Subtotal $100.00, tax $8.75, total $108.75
    expect(preview).toHaveTextContent(/\$100\.00/);
    expect(preview).toHaveTextContent(/\$8\.75/);
    expect(preview).toHaveTextContent(/\$108\.75/);
  });

  it('Replace button issues a bulk POST whose body mirrors the current order + position', async () => {
    listInvoiceLinesMock.mockResolvedValue({
      items: [
        makeLine({ id: 'line-1', position: 0, description: 'Widget A' }),
        makeLine({
          id: 'line-2',
          position: 1,
          description: 'Widget B',
          quantity: 3,
          unit_price_cents: 2500,
          discount_cents: 100,
        }),
      ],
      next_cursor: null,
    });
    replaceInvoiceLinesMock.mockResolvedValue({ items: [], next_cursor: null });

    renderEditor(true);

    const replace = await screen.findByTestId('action-replace');
    const user = userEvent.setup();
    await user.click(replace);

    await waitFor(() => expect(replaceInvoiceLinesMock).toHaveBeenCalled());
    const [, body] = replaceInvoiceLinesMock.mock.calls[0] ?? [];
    expect(body).toEqual({
      lines: [
        {
          item_id: null,
          description: 'Widget A',
          quantity: 2,
          unit: 'ea',
          unit_price_cents: 5000,
          unit_cost_cents: 0,
          discount_cents: 0,
          tax_id: null,
          position: 0,
        },
        {
          item_id: null,
          description: 'Widget B',
          quantity: 3,
          unit: 'ea',
          unit_price_cents: 2500,
          unit_cost_cents: 0,
          discount_cents: 100,
          tax_id: null,
          position: 1,
        },
      ],
    });
  });

  it('disables Replace in read-only mode with an explanatory tooltip', async () => {
    listInvoiceLinesMock.mockResolvedValue({
      items: [makeLine()],
      next_cursor: null,
    });

    renderEditor(false);

    const replace = await screen.findByTestId('action-replace');
    expect(replace).toBeDisabled();
    expect(replace.getAttribute('title')).toMatch(/locked/);
  });
});

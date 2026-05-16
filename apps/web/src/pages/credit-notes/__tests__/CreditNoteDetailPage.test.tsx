import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import CreditNoteDetailPage from '../CreditNoteDetailPage';
import type { CreditNote, CreditNoteStatus, Role } from '@/lib/types';

const getCreditNoteMock = vi.fn();
vi.mock('@/lib/services/creditNotesService', () => ({
  getCreditNote: (id: string) => getCreditNoteMock(id),
  issueCreditNote: vi.fn(),
  applyCreditNote: vi.fn(),
  voidCreditNote: vi.fn(),
}));

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function makeCN(status: CreditNoteStatus, overrides: Partial<CreditNote> = {}): CreditNote {
  return {
    id: '44444444-4444-4444-4444-444444444444',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    credit_note_number: 'CN-0001',
    customer_id: '22222222-2222-2222-2222-222222222222',
    invoice_id: null,
    issue_date: '2026-05-15',
    status,
    reason: null,
    currency_code: 'USD',
    amount_cents: 50000,
    applied_cents: 0,
    notes: null,
    voided_at: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderAt(status: CreditNoteStatus, overrides: Partial<CreditNote> = {}) {
  getCreditNoteMock.mockResolvedValue(makeCN(status, overrides));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/credit-notes/44444444-4444-4444-4444-444444444444']}>
        <Routes>
          <Route path="/credit-notes/:id" element={<CreditNoteDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CreditNoteDetailPage workflow buttons', () => {
  beforeEach(() => {
    getCreditNoteMock.mockReset();
    useMeMock.mockReset();
  });

  it('draft + accounting shows Issue + Void, hides Apply', async () => {
    mockRole('accounting');
    renderAt('draft');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'CN-0001' })).toBeInTheDocument(),
    );
    expect(screen.getByTestId('cn-issue')).toBeInTheDocument();
    expect(screen.queryByTestId('cn-apply')).not.toBeInTheDocument();
    expect(screen.getByTestId('cn-void')).toBeInTheDocument();
  });

  it('issued + accounting shows Apply + Void, hides Issue', async () => {
    mockRole('accounting');
    renderAt('issued');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'CN-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cn-issue')).not.toBeInTheDocument();
    expect(screen.getByTestId('cn-apply')).toBeInTheDocument();
    expect(screen.getByTestId('cn-void')).toBeInTheDocument();
  });

  it('voided is terminal — all workflow buttons hidden', async () => {
    mockRole('accounting');
    renderAt('voided', { voided_at: '2026-05-16T00:00:00.000Z' });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'CN-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cn-issue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cn-apply')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cn-void')).not.toBeInTheDocument();
  });

  it('sales role lacks credit_notes.write — all action buttons hidden', async () => {
    mockRole('sales');
    renderAt('draft');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'CN-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cn-issue')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cn-apply')).not.toBeInTheDocument();
    expect(screen.queryByTestId('cn-void')).not.toBeInTheDocument();
  });

  it('issued + fully applied (remaining=0) hides Apply', async () => {
    mockRole('accounting');
    renderAt('issued', { applied_cents: 50000 });
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'CN-0001' })).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('cn-apply')).not.toBeInTheDocument();
    expect(screen.getByTestId('cn-void')).toBeInTheDocument();
  });
});

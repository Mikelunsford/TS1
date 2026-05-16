/**
 * SourceJETimeline — service-mocked render with two entries.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceJETimeline } from '../SourceJETimeline';
import type * as JournalEntriesService from '@/lib/services/journalEntriesService';
import type { JournalEntry, Role } from '@/lib/types';

const listMock = vi.fn();
vi.mock('@/lib/services/journalEntriesService', async () => {
  const actual = await vi.importActual<typeof JournalEntriesService>(
    '@/lib/services/journalEntriesService',
  );
  return {
    ...actual,
    listJournalEntries: (filters?: unknown) => listMock(filters),
  };
});

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function makeJE(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    entry_number: 'JE-0001',
    entry_date: '2026-05-16',
    description: null,
    status: 'posted',
    source_type: 'invoice',
    source_id: '00000000-0000-0000-0000-000000000abc',
    currency_code: 'USD',
    posted_at: '2026-05-16T00:00:00.000Z',
    reversed_at: null,
    reversed_by_entry_id: null,
    created_at: '2026-05-16T00:00:00.000Z',
    updated_at: '2026-05-16T00:00:00.000Z',
    ...overrides,
  };
}

function renderTimeline() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SourceJETimeline
          sourceType="invoice"
          sourceId="00000000-0000-0000-0000-000000000abc"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SourceJETimeline', () => {
  beforeEach(() => {
    listMock.mockReset();
    useMeMock.mockReset();
  });

  it('renders the two JE rows returned by the service', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({
      items: [
        makeJE({ id: 'a', entry_number: 'JE-0001' }),
        makeJE({ id: 'b', entry_number: 'JE-0002', status: 'reversed' }),
      ],
      next_cursor: null,
    });
    renderTimeline();
    await waitFor(() => expect(screen.getByText('JE-0001')).toBeInTheDocument());
    expect(screen.getByText('JE-0002')).toBeInTheDocument();
    expect(screen.getByTestId('source-je-list')).toBeInTheDocument();
  });

  it('hides itself for callers without finance.journal_entries.read', () => {
    mockRole('customer_user');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    const { container } = renderTimeline();
    expect(container.firstChild).toBeNull();
  });

  it('renders an empty state when no JEs exist', async () => {
    mockRole('accounting');
    listMock.mockResolvedValue({ items: [], next_cursor: null });
    renderTimeline();
    await waitFor(() => expect(screen.getByTestId('source-je-empty')).toBeInTheDocument());
  });
});

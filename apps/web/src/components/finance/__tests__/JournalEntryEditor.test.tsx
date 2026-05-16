/**
 * JournalEntryEditor — balance check unit tests.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { JournalEntryEditor } from '../JournalEntryEditor';
import type { JEEditorLine } from '../journalEntryEditorHelpers';

vi.mock('@/lib/services/chartOfAccountsService', () => ({
  listChartOfAccounts: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
}));

const aaaa = '00000000-0000-0000-0000-00000000aaaa';
const bbbb = '00000000-0000-0000-0000-00000000bbbb';

function Harness({ initial }: { initial: JEEditorLine[] }) {
  const [lines, setLines] = useState<JEEditorLine[]>(initial);
  return (
    <JournalEntryEditor
      lines={lines}
      onChange={setLines}
      currency="USD"
      editable
    />
  );
}

function renderEditor(initial: JEEditorLine[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness initial={initial} />
    </QueryClientProvider>,
  );
}

describe('JournalEntryEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Out of balance" when sum Dr != sum Cr', () => {
    renderEditor([
      { account_id: aaaa, debit_cents: 10000, credit_cents: 0, memo: '' },
      { account_id: bbbb, debit_cents: 0, credit_cents: 5000, memo: '' },
    ]);
    const status = screen.getByTestId('je-balance-status');
    expect(status.textContent ?? '').toMatch(/Diff/);
  });

  it('shows "Balanced" when sum Dr === sum Cr (both > 0)', () => {
    renderEditor([
      { account_id: aaaa, debit_cents: 10000, credit_cents: 0, memo: '' },
      { account_id: bbbb, debit_cents: 0, credit_cents: 10000, memo: '' },
    ]);
    const status = screen.getByTestId('je-balance-status');
    expect(status.textContent ?? '').toMatch(/Balanced/);
  });

  it('treats all-zero totals as out-of-balance (need at least one debit)', () => {
    renderEditor([
      { account_id: '', debit_cents: 0, credit_cents: 0, memo: '' },
      { account_id: '', debit_cents: 0, credit_cents: 0, memo: '' },
    ]);
    const status = screen.getByTestId('je-balance-status');
    expect(status.textContent ?? '').not.toMatch(/^Balanced$/);
  });

  it('exposes per-line debit/credit inputs for editing', () => {
    renderEditor([
      { account_id: aaaa, debit_cents: 0, credit_cents: 0, memo: '' },
      { account_id: bbbb, debit_cents: 0, credit_cents: 0, memo: '' },
    ]);
    expect(screen.getByTestId('je-line-0')).toBeInTheDocument();
    expect(screen.getByTestId('je-line-1')).toBeInTheDocument();
  });
});

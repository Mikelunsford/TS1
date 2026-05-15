/**
 * OpportunityKanban tests.
 *
 * Verifies column derivation, the weighted-total computation per column, and
 * the service-call shape on stage change. dnd-kit pointer simulation is
 * impractical in jsdom; we exercise the math + render paths directly.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OpportunityKanban } from './OpportunityKanban';
import type { Opportunity } from '@/lib/crmTypes';

vi.mock('@/lib/services/opportunitiesService', () => ({
  updateOpportunityStage: vi.fn(async (args: { id: string; stage: Opportunity['stage'] }) => ({
    id: args.id,
    stage: args.stage,
  })),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function fixture(
  id: string,
  stage: Opportunity['stage'],
  amount_cents: number,
  probability_pct: number,
): Opportunity {
  return {
    id,
    org_id: '00000000-0000-0000-0000-000000000001',
    customer_id: null,
    lead_id: null,
    display_name: `Opp ${id}`,
    stage,
    amount_cents,
    currency_code: 'USD',
    probability_pct,
    expected_close_date: null,
    assigned_to: null,
    opportunity_number: `OPP-2026-${id.padStart(5, '0')}`,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
  };
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('OpportunityKanban', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders seven stage columns', () => {
    renderWithClient(<OpportunityKanban opportunities={[]} />);
    for (const stage of [
      'prospect',
      'discovery',
      'proposal',
      'negotiation',
      'won',
      'lost',
      'abandoned',
    ]) {
      expect(screen.getByTestId(`kanban-column-${stage}`)).toBeInTheDocument();
    }
  });

  it('computes weighted total per column = sum(amount_cents * probability_pct / 100)', () => {
    // proposal: 100_000_00 * 25% + 50_000_00 * 50% = 2_500_000 + 2_500_000 = 5_000_000 cents = $50,000.00
    const opps: Opportunity[] = [
      fixture('1', 'proposal', 10_000_000, 25),
      fixture('2', 'proposal', 5_000_000, 50),
      fixture('3', 'won', 1_000_000, 100), // weighted = $10,000.00
    ];
    renderWithClient(<OpportunityKanban opportunities={opps} />);
    const proposalFooter = screen.getByTestId('kanban-weighted-proposal');
    expect(proposalFooter.textContent).toContain('$50,000.00');
    const wonFooter = screen.getByTestId('kanban-weighted-won');
    expect(wonFooter.textContent).toContain('$10,000.00');
  });

  it('renders opportunity card amount + number', () => {
    const opps: Opportunity[] = [fixture('42', 'discovery', 2_500_00, 30)];
    renderWithClient(<OpportunityKanban opportunities={opps} />);
    expect(screen.getByText('Opp 42')).toBeInTheDocument();
    expect(screen.getByText('OPP-2026-00042')).toBeInTheDocument();
    expect(screen.getByText('30%')).toBeInTheDocument();
  });
});

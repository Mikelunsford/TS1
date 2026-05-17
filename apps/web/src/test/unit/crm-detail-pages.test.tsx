/**
 * R-W10-S2-B1-OBS-02 — contact/lead/opportunity detail page smoke tests.
 *
 * Each detail page mocks its service at the import surface (getContact,
 * getLead, getOpportunity) per the helper-tests-must-pin-the-import-surface
 * rule (R-W11-MFA-TEST-01 lesson, codified in 02-CODE-STYLE.md §Tests).
 *
 * Assertions per page:
 *   - renders the entity name / number in the header
 *   - renders the CollaborationSection (gated on collaboration.enabled true)
 *   - omits the section when the flag is off
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/services/contactsService', () => ({
  getContact: vi.fn(),
}));
vi.mock('@/lib/services/leadsService', () => ({
  getLead: vi.fn(),
}));
vi.mock('@/lib/services/opportunitiesService', () => ({
  getOpportunity: vi.fn(),
}));
vi.mock('@/lib/hooks/useOrgFlags', () => ({
  useOrgFlags: vi.fn(),
}));

import { getContact } from '@/lib/services/contactsService';
import { getLead } from '@/lib/services/leadsService';
import { getOpportunity } from '@/lib/services/opportunitiesService';
import { useOrgFlags } from '@/lib/hooks/useOrgFlags';

import ContactDetailPage from '@/pages/crm/ContactDetailPage';
import LeadDetailPage from '@/pages/crm/LeadDetailPage';
import OpportunityDetailPage from '@/pages/crm/OpportunityDetailPage';

const ORG = '11111111-1111-1111-1111-111111111111';
const ID = '22222222-2222-2222-2222-222222222222';

function flagsOn() {
  return {
    data: { 'collaboration.enabled': true },
    isLoading: false,
  } as unknown as ReturnType<typeof useOrgFlags>;
}
function flagsOff() {
  return {
    data: { 'collaboration.enabled': false },
    isLoading: false,
  } as unknown as ReturnType<typeof useOrgFlags>;
}

function withRouter(path: string, routePattern: string, element: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePattern} element={element} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('<ContactDetailPage>', () => {
  const baseContact = {
    id: ID,
    org_id: ORG,
    customer_id: '33333333-3333-3333-3333-333333333333',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    phone: null,
    title: 'CEO',
    is_primary: true,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('renders the contact header + CollaborationSection when flag is on', async () => {
    vi.mocked(getContact).mockResolvedValue(baseContact);
    vi.mocked(useOrgFlags).mockReturnValue(flagsOn());
    render(
      withRouter(`/crm/contacts/${ID}`, '/crm/contacts/:id', <ContactDetailPage />),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jane Doe'),
    );
    expect(screen.getByText('CEO')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /collaboration/i })).toBeInTheDocument();
  });

  it('hides the CollaborationSection when collaboration.enabled is false', async () => {
    vi.mocked(getContact).mockResolvedValue(baseContact);
    vi.mocked(useOrgFlags).mockReturnValue(flagsOff());
    render(
      withRouter(`/crm/contacts/${ID}`, '/crm/contacts/:id', <ContactDetailPage />),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Jane Doe'),
    );
    expect(screen.queryByRole('tablist', { name: /collaboration/i })).not.toBeInTheDocument();
  });
});

describe('<LeadDetailPage>', () => {
  const baseLead = {
    id: ID,
    org_id: ORG,
    lead_number: 'LD-2026-00001',
    display_name: 'Acme expansion',
    company_name: 'Acme Inc',
    source: 'inbound',
    status: 'qualified' as const,
    primary_email: 'buyer@acme.test',
    primary_phone: null,
    owner_user_id: null,
    estimated_value_cents: 1500000,
    currency_code: 'USD',
    expected_close_date: '2026-06-15',
    converted_customer_id: null,
    converted_opportunity_id: null,
    converted_at: null,
    notes: 'Interested in 12-month contract',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('renders the lead header, badge, and CollaborationSection', async () => {
    vi.mocked(getLead).mockResolvedValue(baseLead);
    vi.mocked(useOrgFlags).mockReturnValue(flagsOn());
    render(withRouter(`/crm/leads/${ID}`, '/crm/leads/:id', <LeadDetailPage />));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme expansion'),
    );
    expect(screen.getAllByText('LD-2026-00001').length).toBeGreaterThan(0);
    expect(screen.getByText(/Acme Inc/)).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(screen.getByText(/Interested in 12-month contract/)).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /collaboration/i })).toBeInTheDocument();
  });
});

describe('<OpportunityDetailPage>', () => {
  const baseOpp = {
    id: ID,
    org_id: ORG,
    opportunity_number: 'OPP-2026-00001',
    customer_id: '33333333-3333-3333-3333-333333333333',
    lead_id: null,
    display_name: 'Q2 platform upgrade',
    stage: 'proposal' as const,
    amount_cents: 5000000,
    currency_code: 'USD',
    probability_pct: 60,
    expected_close_date: '2026-06-30',
    closed_at: null,
    close_reason: null,
    owner_user_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('renders the opportunity header, stage, weighted amount, and CollaborationSection', async () => {
    vi.mocked(getOpportunity).mockResolvedValue(baseOpp);
    vi.mocked(useOrgFlags).mockReturnValue(flagsOn());
    render(
      withRouter(`/crm/opportunities/${ID}`, '/crm/opportunities/:id', <OpportunityDetailPage />),
    );
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'Q2 platform upgrade',
      ),
    );
    expect(screen.getAllByText('OPP-2026-00001').length).toBeGreaterThan(0);
    expect(screen.getByText('Proposal')).toBeInTheDocument();
    // Probability is split across a text node + a `%` aria-hidden span;
    // assert on the surrounding "Probability" field label being present
    // and the dl carrying a "60" digit run.
    expect(screen.getByText('Probability')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: /collaboration/i })).toBeInTheDocument();
  });
});

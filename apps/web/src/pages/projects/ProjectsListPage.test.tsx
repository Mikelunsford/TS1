import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectsListPage from './ProjectsListPage';
import type { Project, Role } from '@/lib/types';

const listProjectsMock = vi.fn();
vi.mock('@/lib/services/projectsService', () => ({
  listProjects: (filters?: unknown) => listProjectsMock(filters),
}));

let activeRole: Role | null = 'org_admin';
vi.mock('@/lib/hooks/useActiveRole', () => ({
  useActiveRole: () => activeRole,
}));

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    project_number: 'P-0001',
    quote_id: null,
    customer_id: null,
    customer_name: 'Acme',
    name: 'Project Alpha',
    status: 'pending',
    currency_code: 'USD',
    total_cents: 100000,
    budget_cents: 100000,
    due_date: null,
    invoice_id: null,
    bom_finalized_at: null,
    bom_finalized_by: null,
    ready_to_build_at: null,
    sent_to_production_at: null,
    production_started_at: null,
    production_completed_at: null,
    ready_to_ship_at: null,
    shipping_completed_at: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderPage(initial = '/projects') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <ProjectsListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsListPage', () => {
  beforeEach(() => {
    listProjectsMock.mockReset();
    activeRole = 'org_admin';
  });

  it('renders projects returned by the service with formatted total', async () => {
    listProjectsMock.mockResolvedValue({
      items: [
        makeProject({ id: 'a', project_number: 'P-A', name: 'Alpha', total_cents: 199900 }),
        makeProject({
          id: 'b',
          project_number: 'P-B',
          name: 'Beta',
          total_cents: 500000,
          currency_code: 'EUR',
        }),
      ],
      next_cursor: null,
    });

    renderPage();

    await waitFor(() => expect(screen.getByText('P-A')).toBeInTheDocument());
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('P-B')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText(/1,999\.00/)).toBeInTheDocument();
  });

  it('passes status filter when a chip is clicked', async () => {
    listProjectsMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage('/projects?status=in_production');

    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());
    const firstCall = listProjectsMock.mock.calls[0]?.[0];
    expect(firstCall).toMatchObject({ status: 'in_production' });
  });

  it('shows "New project" link for roles that can write', async () => {
    activeRole = 'ops';
    listProjectsMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('No projects found')).toBeInTheDocument());
    expect(screen.queryByTestId('projects-new-link')).toBeInTheDocument();
  });

  it('hides "New project" link for read-only roles (viewer)', async () => {
    activeRole = 'viewer';
    listProjectsMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(screen.getByText('No projects found')).toBeInTheDocument());
    expect(screen.queryByTestId('projects-new-link')).not.toBeInTheDocument();
  });

  it('applies q on search submit', async () => {
    listProjectsMock.mockResolvedValue({ items: [], next_cursor: null });
    renderPage();
    await waitFor(() => expect(listProjectsMock).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'alpha' } });
    fireEvent.submit(screen.getByRole('search'));

    await waitFor(() => {
      const lastCall = listProjectsMock.mock.calls[listProjectsMock.mock.calls.length - 1]?.[0];
      expect(lastCall).toMatchObject({ q: 'alpha' });
    });
  });
});

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProjectDetailPage from './ProjectDetailPage';
import type { Project, ProjectState, Role } from '@/lib/types';

const getProjectMock = vi.fn();
const listPhasesMock = vi.fn();

vi.mock('@/lib/services/projectsService', () => ({
  getProject: (id: string) => getProjectMock(id),
  closeProject: vi.fn(),
  reopenProject: vi.fn(),
  updateProject: vi.fn(),
}));

vi.mock('@/lib/services/projectPhasesService', () => ({
  listPhases: (id: string) => listPhasesMock(id),
  createPhase: vi.fn(),
  patchPhase: vi.fn(),
  deletePhase: vi.fn(),
  reorderPhases: vi.fn(),
  updatePhaseStatus: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let activeRole: Role | null = 'org_admin';
vi.mock('@/lib/hooks/useActiveRole', () => ({
  useActiveRole: () => activeRole,
}));

function makeProject(status: ProjectState, overrides: Partial<Project> = {}): Project {
  return {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    project_number: 'P-0001',
    quote_id: null,
    customer_id: null,
    customer_name: 'Acme',
    name: 'Project Alpha',
    status,
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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectDetailPage', () => {
  beforeEach(() => {
    getProjectMock.mockReset();
    listPhasesMock.mockReset();
    listPhasesMock.mockResolvedValue({ items: [], next_cursor: null });
    activeRole = 'org_admin';
  });

  it('shows Close button when status=in_production and role can close', async () => {
    getProjectMock.mockResolvedValue(makeProject('in_production'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument());
    expect(screen.queryByTestId('project-close')).toBeInTheDocument();
    expect(screen.queryByTestId('project-reopen')).not.toBeInTheDocument();
  });

  it('shows Reopen button when status=completed and role can close', async () => {
    getProjectMock.mockResolvedValue(makeProject('completed'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument());
    expect(screen.queryByTestId('project-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('project-close')).not.toBeInTheDocument();
  });

  it('hides Close and Reopen when status=pending (illegal transitions)', async () => {
    getProjectMock.mockResolvedValue(makeProject('pending'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument());
    expect(screen.queryByTestId('project-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-reopen')).not.toBeInTheDocument();
  });

  it('hides Close/Edit/Reopen when role is viewer', async () => {
    activeRole = 'viewer';
    getProjectMock.mockResolvedValue(makeProject('in_production'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument());
    expect(screen.queryByTestId('project-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('project-edit')).not.toBeInTheDocument();
  });

  it('hides Reopen even on completed when role lacks projects.close (sales)', async () => {
    activeRole = 'sales';
    getProjectMock.mockResolvedValue(makeProject('completed'));
    renderPage();
    await waitFor(() => expect(screen.getByText('Project Alpha')).toBeInTheDocument());
    expect(screen.queryByTestId('project-reopen')).not.toBeInTheDocument();
    // Sales can read projects but not write -> Edit hidden.
    expect(screen.queryByTestId('project-edit')).not.toBeInTheDocument();
  });
});

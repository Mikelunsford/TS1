import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PhasesEditor } from './PhasesEditor';
import type { PhaseStatus, ProjectPhase, Role } from '@/lib/types';

const updatePhaseStatusMock = vi.fn();
vi.mock('@/lib/services/projectPhasesService', () => ({
  createPhase: vi.fn(),
  patchPhase: vi.fn(),
  deletePhase: vi.fn(),
  reorderPhases: vi.fn(),
  updatePhaseStatus: (...args: unknown[]) => updatePhaseStatusMock(...args),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

let activeRole: Role | null = 'org_admin';
vi.mock('@/lib/hooks/useActiveRole', () => ({
  useActiveRole: () => activeRole,
}));

function makePhase(status: PhaseStatus, overrides: Partial<ProjectPhase> = {}): ProjectPhase {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    org_id: '00000000-0000-0000-0000-0000000000aa',
    project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    position: 0,
    name: 'Cutting',
    description: null,
    status,
    planned_start_at: null,
    planned_end_at: null,
    actual_start_at: null,
    actual_end_at: null,
    budget_cents: 0,
    notes: null,
    created_at: '2026-05-15T00:00:00.000Z',
    updated_at: '2026-05-15T00:00:00.000Z',
    ...overrides,
  };
}

function renderWith(phases: ProjectPhase[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhasesEditor projectId="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" phases={phases} currency="USD" />
    </QueryClientProvider>,
  );
}

describe('PhasesEditor', () => {
  beforeEach(() => {
    updatePhaseStatusMock.mockReset();
    activeRole = 'org_admin';
  });

  it('shows Start button only on pending phases (pending -> active is legal)', async () => {
    renderWith([makePhase('pending', { id: 'p1' })]);
    await waitFor(() => expect(screen.getByText('Cutting')).toBeInTheDocument());
    expect(screen.getByTestId('phase-start-p1')).toBeInTheDocument();
    // Complete is illegal directly from pending in this matrix.
    expect(screen.queryByTestId('phase-complete-p1')).not.toBeInTheDocument();
    expect(screen.getByTestId('phase-cancel-p1')).toBeInTheDocument();
  });

  it('shows Complete button on active phases', async () => {
    renderWith([makePhase('active', { id: 'p2' })]);
    await waitFor(() => expect(screen.getByText('Cutting')).toBeInTheDocument());
    expect(screen.getByTestId('phase-complete-p2')).toBeInTheDocument();
    // Start hidden because already active (active -> active is idempotent but
    // we hide the no-op button).
    expect(screen.getByTestId('phase-cancel-p2')).toBeInTheDocument();
  });

  it('hides cancel for terminal cancelled status', async () => {
    renderWith([makePhase('cancelled', { id: 'p3' })]);
    await waitFor(() => expect(screen.getByText('Cutting')).toBeInTheDocument());
    expect(screen.queryByTestId('phase-cancel-p3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('phase-start-p3')).not.toBeInTheDocument();
    expect(screen.queryByTestId('phase-complete-p3')).not.toBeInTheDocument();
  });

  it('hides all write affordances for viewer role', async () => {
    activeRole = 'viewer';
    renderWith([makePhase('pending', { id: 'p4' })]);
    await waitFor(() => expect(screen.getByText('Cutting')).toBeInTheDocument());
    expect(screen.queryByTestId('phase-start-p4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('phase-cancel-p4')).not.toBeInTheDocument();
    expect(screen.queryByTestId('phases-add-toggle')).not.toBeInTheDocument();
  });
});

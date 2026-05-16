/**
 * Gating matrix tests for ProductionWorkflowButtons. Wave 8f / Phase 13.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProductionWorkflowButtons } from '../ProductionWorkflowButtons';
import type { Role } from '@/lib/types';
import type { ProductionRunState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: ProductionRunState) {
  return render(
    <ProductionWorkflowButtons
      status={status}
      onStart={() => undefined}
      onComplete={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('ProductionWorkflowButtons', () => {
  it('shows Start + Cancel on scheduled for ops', () => {
    mockRole('ops');
    renderButtons('scheduled');
    expect(screen.getByTestId('run-action-start')).toBeInTheDocument();
    expect(screen.getByTestId('run-action-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('run-action-complete')).not.toBeInTheDocument();
  });

  it('shows Complete + Cancel on in_progress', () => {
    mockRole('ops');
    renderButtons('in_progress');
    expect(screen.getByTestId('run-action-complete')).toBeInTheDocument();
    expect(screen.getByTestId('run-action-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('run-action-start')).not.toBeInTheDocument();
  });

  it('hides all actions on completed (terminal)', () => {
    mockRole('ops');
    renderButtons('completed');
    expect(screen.queryByTestId('run-action-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-action-complete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-action-cancel')).not.toBeInTheDocument();
  });

  it('hides write actions for viewer on scheduled', () => {
    mockRole('viewer');
    renderButtons('scheduled');
    expect(screen.queryByTestId('run-action-start')).not.toBeInTheDocument();
    expect(screen.queryByTestId('run-action-cancel')).not.toBeInTheDocument();
  });
});

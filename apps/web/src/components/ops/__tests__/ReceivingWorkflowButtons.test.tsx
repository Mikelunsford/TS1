/**
 * Gating matrix tests for ReceivingWorkflowButtons. Wave 8f / Phase 13.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReceivingWorkflowButtons } from '../ReceivingWorkflowButtons';
import type { Role } from '@/lib/types';
import type { ReceivingOrderState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: ReceivingOrderState) {
  return render(
    <ReceivingWorkflowButtons
      status={status}
      onReceive={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('ReceivingWorkflowButtons', () => {
  it('shows Receive + Cancel on open for ops', () => {
    mockRole('ops');
    renderButtons('open');
    expect(screen.getByTestId('ro-action-receive')).toBeInTheDocument();
    expect(screen.getByTestId('ro-action-cancel')).toBeInTheDocument();
  });

  it('shows Receive + Cancel on partial', () => {
    mockRole('ops');
    renderButtons('partial');
    expect(screen.getByTestId('ro-action-receive')).toBeInTheDocument();
    expect(screen.getByTestId('ro-action-cancel')).toBeInTheDocument();
  });

  it('hides all actions on received (terminal)', () => {
    mockRole('ops');
    renderButtons('received');
    expect(screen.queryByTestId('ro-action-receive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ro-action-cancel')).not.toBeInTheDocument();
  });

  it('hides all actions on cancelled (terminal)', () => {
    mockRole('ops');
    renderButtons('cancelled');
    expect(screen.queryByTestId('ro-action-receive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ro-action-cancel')).not.toBeInTheDocument();
  });

  it('hides write actions for viewer', () => {
    mockRole('viewer');
    renderButtons('open');
    expect(screen.queryByTestId('ro-action-receive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ro-action-cancel')).not.toBeInTheDocument();
  });
});

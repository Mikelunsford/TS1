/**
 * Gating matrix tests for PurchaseOrderWorkflowButtons.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PurchaseOrderWorkflowButtons } from '../PurchaseOrderWorkflowButtons';
import type { Role } from '@/lib/types';
import type { PurchaseOrderState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: PurchaseOrderState) {
  return render(
    <PurchaseOrderWorkflowButtons
      status={status}
      onSubmit={() => undefined}
      onApprove={() => undefined}
      onReceive={() => undefined}
      onClose={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('PurchaseOrderWorkflowButtons', () => {
  it('shows Submit + Cancel on draft for ops', () => {
    mockRole('ops');
    renderButtons('draft');
    expect(screen.getByTestId('po-action-submit')).toBeInTheDocument();
    expect(screen.getByTestId('po-action-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('po-action-approve')).not.toBeInTheDocument();
  });

  it('shows Receive + Close on received', () => {
    mockRole('ops');
    renderButtons('received');
    expect(screen.getByTestId('po-action-close')).toBeInTheDocument();
    // received → received is not legal; Receive should NOT show.
    expect(screen.queryByTestId('po-action-receive')).not.toBeInTheDocument();
  });

  it('hides all on closed (terminal)', () => {
    mockRole('ops');
    renderButtons('closed');
    expect(screen.queryByTestId('po-action-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-action-receive')).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-action-close')).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-action-cancel')).not.toBeInTheDocument();
  });

  it('hides write actions for viewer', () => {
    mockRole('viewer');
    renderButtons('draft');
    expect(screen.queryByTestId('po-action-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-action-cancel')).not.toBeInTheDocument();
  });
});

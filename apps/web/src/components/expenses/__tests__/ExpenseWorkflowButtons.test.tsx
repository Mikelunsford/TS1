/**
 * Gating matrix tests for ExpenseWorkflowButtons.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExpenseWorkflowButtons } from '../ExpenseWorkflowButtons';
import type { Role } from '@/lib/types';
import type { ExpenseState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: ExpenseState) {
  return render(
    <ExpenseWorkflowButtons
      status={status}
      onSubmit={() => undefined}
      onApprove={() => undefined}
      onReject={() => undefined}
      onReimburse={() => undefined}
      onPay={() => undefined}
    />,
  );
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('ExpenseWorkflowButtons', () => {
  it('shows Submit on draft for accounting', () => {
    mockRole('accounting');
    renderButtons('draft');
    expect(screen.getByTestId('exp-action-submit')).toBeInTheDocument();
  });

  it('shows Approve + Reject on submitted for accounting', () => {
    mockRole('accounting');
    renderButtons('submitted');
    expect(screen.getByTestId('exp-action-approve')).toBeInTheDocument();
    expect(screen.getByTestId('exp-action-reject')).toBeInTheDocument();
  });

  it('shows Reimburse + Pay on approved for accounting', () => {
    mockRole('accounting');
    renderButtons('approved');
    expect(screen.getByTestId('exp-action-reimburse')).toBeInTheDocument();
    expect(screen.getByTestId('exp-action-pay')).toBeInTheDocument();
  });

  it('shows Submit on rejected (rejected → submitted is legal)', () => {
    mockRole('accounting');
    renderButtons('rejected');
    expect(screen.getByTestId('exp-action-submit')).toBeInTheDocument();
  });

  it('hides everything on paid (terminal)', () => {
    mockRole('accounting');
    renderButtons('paid');
    expect(screen.queryByTestId('exp-action-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('exp-action-approve')).not.toBeInTheDocument();
    expect(screen.queryByTestId('exp-action-reject')).not.toBeInTheDocument();
    expect(screen.queryByTestId('exp-action-reimburse')).not.toBeInTheDocument();
    expect(screen.queryByTestId('exp-action-pay')).not.toBeInTheDocument();
  });
});

/**
 * Gating matrix tests for ShipmentWorkflowButtons. Wave 8f / Phase 13.
 */
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ShipmentWorkflowButtons } from '../ShipmentWorkflowButtons';
import type { Role } from '@/lib/types';
import type { ShipmentState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: ShipmentState) {
  return render(
    <ShipmentWorkflowButtons
      status={status}
      onStartLoading={() => undefined}
      onShip={() => undefined}
      onCancel={() => undefined}
    />,
  );
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('ShipmentWorkflowButtons', () => {
  it('shows Start loading + Cancel on scheduled', () => {
    mockRole('ops');
    renderButtons('scheduled');
    expect(screen.getByTestId('shipment-action-start-loading')).toBeInTheDocument();
    expect(screen.getByTestId('shipment-action-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('shipment-action-ship')).not.toBeInTheDocument();
  });

  it('shows Ship + Cancel on loading', () => {
    mockRole('ops');
    renderButtons('loading');
    expect(screen.getByTestId('shipment-action-ship')).toBeInTheDocument();
    expect(screen.getByTestId('shipment-action-cancel')).toBeInTheDocument();
    expect(screen.queryByTestId('shipment-action-start-loading')).not.toBeInTheDocument();
  });

  it('hides all actions on shipped (terminal)', () => {
    mockRole('ops');
    renderButtons('shipped');
    expect(screen.queryByTestId('shipment-action-start-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shipment-action-ship')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shipment-action-cancel')).not.toBeInTheDocument();
  });

  it('hides write actions for viewer on scheduled', () => {
    mockRole('viewer');
    renderButtons('scheduled');
    expect(screen.queryByTestId('shipment-action-start-loading')).not.toBeInTheDocument();
    expect(screen.queryByTestId('shipment-action-cancel')).not.toBeInTheDocument();
  });
});

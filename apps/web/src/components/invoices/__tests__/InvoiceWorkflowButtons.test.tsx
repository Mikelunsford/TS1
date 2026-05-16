/**
 * Tests for InvoiceWorkflowButtons — the gating matrix is (a) capability
 * check + (b) transition legality. Per-button visibility table:
 *
 *   Submit  : showable when can('invoices.write') and from is draft.
 *   Send    : showable when can('invoices.send') and status in pending|sent.
 *   Hold    : showable when can('invoices.write') and status in pending|sent.
 *   Release : showable when can('invoices.write') and status === on_hold.
 *   Void    : showable when can('invoices.void') and from is non-terminal.
 *   Duplicate / Download PDF : always cap-gated only.
 *   Convert from quote / project : draft only.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InvoiceWorkflowButtons } from '../InvoiceWorkflowButtons';
import type { Role } from '@/lib/types';
import type { InvoiceState } from '@/lib/workflow';

const useMeMock = vi.fn();
vi.mock('@/lib/hooks/useMe', () => ({
  useMe: () => useMeMock(),
}));

function mockRole(role: Role | null) {
  useMeMock.mockReturnValue({ data: role ? { active_role: role } : null });
}

function renderButtons(status: InvoiceState) {
  const handlers = {
    onSubmit: vi.fn(),
    onSend: vi.fn(),
    onHold: vi.fn(),
    onRelease: vi.fn(),
    onVoid: vi.fn(),
    onDuplicate: vi.fn(),
    onConvertFromQuote: vi.fn(),
    onConvertFromProject: vi.fn(),
    onDownloadPdf: vi.fn(),
  };
  const result = render(<InvoiceWorkflowButtons status={status} {...handlers} />);
  return { ...result, handlers };
}

afterEach(() => {
  useMeMock.mockReset();
});

describe('InvoiceWorkflowButtons', () => {
  it('shows Submit + Convert + Duplicate + PDF for draft / accounting', () => {
    mockRole('accounting');
    renderButtons('draft');

    expect(screen.getByTestId('action-submit')).toBeInTheDocument();
    expect(screen.getByTestId('action-convert-from-quote')).toBeInTheDocument();
    expect(screen.getByTestId('action-convert-from-project')).toBeInTheDocument();
    expect(screen.getByTestId('action-duplicate')).toBeInTheDocument();
    expect(screen.getByTestId('action-download-pdf')).toBeInTheDocument();

    // Send/Release should NOT appear from draft.
    expect(screen.queryByTestId('action-send')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-release')).not.toBeInTheDocument();
  });

  it('shows Release from on_hold and hides Hold (no on_hold→on_hold)', () => {
    mockRole('accounting');
    renderButtons('on_hold');

    expect(screen.getByTestId('action-release')).toBeInTheDocument();
    // Hold is not in INVOICE_TRANSITIONS for on_hold (transitions are pending|sent|cancelled).
    expect(screen.queryByTestId('action-hold')).not.toBeInTheDocument();
  });

  it('hides Void on terminal states (refunded / cancelled)', () => {
    mockRole('accounting');
    const { unmount } = renderButtons('refunded');
    expect(screen.queryByTestId('action-void')).not.toBeInTheDocument();
    unmount();

    useMeMock.mockReset();
    mockRole('accounting');
    renderButtons('cancelled');
    expect(screen.queryByTestId('action-void')).not.toBeInTheDocument();
  });

  it('hides write-family actions for viewer', () => {
    mockRole('viewer');
    renderButtons('draft');

    expect(screen.queryByTestId('action-submit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-hold')).not.toBeInTheDocument();
    expect(screen.queryByTestId('action-void')).not.toBeInTheDocument();
    // Viewer keeps read-only PDF (capability `invoices.read`).
    expect(screen.getByTestId('action-download-pdf')).toBeInTheDocument();
  });

  it('shows Send + Hold from sent / accounting; Submit no longer applicable', () => {
    mockRole('accounting');
    renderButtons('sent');

    expect(screen.getByTestId('action-send')).toBeInTheDocument();
    expect(screen.getByTestId('action-hold')).toBeInTheDocument();
    expect(screen.queryByTestId('action-submit')).not.toBeInTheDocument();
  });

  it('forwards the click to the right handler', async () => {
    mockRole('accounting');
    const { handlers } = renderButtons('draft');
    const user = userEvent.setup();

    await user.click(screen.getByTestId('action-submit'));
    expect(handlers.onSubmit).toHaveBeenCalled();

    await user.click(screen.getByTestId('action-duplicate'));
    expect(handlers.onDuplicate).toHaveBeenCalled();
  });
});

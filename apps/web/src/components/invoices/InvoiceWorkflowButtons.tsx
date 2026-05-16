/**
 * InvoiceWorkflowButtons — centralizes the 9 invoice workflow buttons +
 * capability + transition gating. Mirrors the structure FE-A used for
 * QuoteDetailPage but compressed into a single component so the detail
 * page only has to wire callbacks and the pending flags.
 *
 * Visibility rules (every button must satisfy BOTH):
 *   (a) `can(role, cap)` returns true, AND
 *   (b) when the action mutates `status`, `canTransition('invoice', from, to)`
 *       returns true. Stateless actions (send / duplicate / convert / download)
 *       skip (b) but still cap-gate.
 *
 * Workflow target mapping (per `INVOICE_TRANSITIONS` in lib/workflow.ts):
 *   Submit  : draft           → pending
 *   Send    : NO state change (stamps sent_at); surface from pending / sent
 *   Hold    : pending|sent    → on_hold
 *   Release : on_hold         → pending
 *   Void    : draft|pending|sent|partially_paid|overdue → cancelled
 *             (uses `cancelled` per the migration 0050+ matrix; the BE
 *             handler is named `voidInvoice` and routes through the
 *             cancelled terminal state)
 *   Duplicate / ConvertFromQuote / ConvertFromProject / Download PDF
 *   : capability-gated only.
 */
import type { ReactNode } from 'react';

import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { canTransition, type InvoiceState } from '@/lib/workflow';

export interface InvoiceWorkflowCallbacks {
  onSubmit: () => void;
  onSend: () => void;
  onHold: () => void;
  onRelease: () => void;
  onVoid: () => void;
  onDuplicate: () => void;
  onConvertFromQuote: () => void;
  onConvertFromProject: () => void;
  onDownloadPdf: () => void;
}

export interface InvoiceWorkflowPending {
  submit?: boolean;
  send?: boolean;
  hold?: boolean;
  release?: boolean;
  voidPending?: boolean;
  duplicate?: boolean;
  pdf?: boolean;
}

export interface InvoiceWorkflowButtonsProps extends InvoiceWorkflowCallbacks {
  status: InvoiceState;
  pending?: InvoiceWorkflowPending;
}

export function InvoiceWorkflowButtons({
  status,
  onSubmit,
  onSend,
  onHold,
  onRelease,
  onVoid,
  onDuplicate,
  onConvertFromQuote,
  onConvertFromProject,
  onDownloadPdf,
  pending = {},
}: InvoiceWorkflowButtonsProps) {
  const { can } = useCapabilities();

  // Gating: cap + transition legality. canTransition is idempotent on
  // `from === to`, so we additionally require `status !== target` to keep
  // self-transitions from showing meaningless buttons (e.g. "Hold" while
  // already on_hold).
  const isReal = (target: InvoiceState) =>
    status !== target && canTransition('invoice', status, target);

  const showSubmit = can('invoices.write') && isReal('pending');
  const showSend = can('invoices.send') && (status === 'pending' || status === 'sent');
  const showHold = can('invoices.write') && isReal('on_hold');
  const showRelease =
    can('invoices.write') && status === 'on_hold' && isReal('pending');
  // Void routes the row to `cancelled` per the prod enum + 0052 matrix.
  const showVoid = can('invoices.void') && isReal('cancelled');
  const showDuplicate = can('invoices.write');
  const showConvertFromQuote = can('invoices.write') && status === 'draft';
  const showConvertFromProject = can('invoices.write') && status === 'draft';
  const showDownloadPdf = can('invoices.read');

  return (
    <div className="flex flex-wrap gap-2" data-testid="invoice-workflow-buttons">
      {showSubmit && (
        <WorkflowButton
          data-testid="action-submit"
          variant="primary"
          onClick={onSubmit}
          pending={pending.submit ?? false}
        >
          Submit
        </WorkflowButton>
      )}
      {showSend && (
        <WorkflowButton
          data-testid="action-send"
          onClick={onSend}
          pending={pending.send ?? false}
        >
          Send
        </WorkflowButton>
      )}
      {showHold && (
        <WorkflowButton
          data-testid="action-hold"
          onClick={onHold}
          pending={pending.hold ?? false}
        >
          Hold
        </WorkflowButton>
      )}
      {showRelease && (
        <WorkflowButton
          data-testid="action-release"
          onClick={onRelease}
          pending={pending.release ?? false}
        >
          Release
        </WorkflowButton>
      )}
      {showVoid && (
        <WorkflowButton
          data-testid="action-void"
          variant="danger"
          onClick={onVoid}
          pending={pending.voidPending ?? false}
        >
          Void
        </WorkflowButton>
      )}
      {showDuplicate && (
        <WorkflowButton
          data-testid="action-duplicate"
          onClick={onDuplicate}
          pending={pending.duplicate ?? false}
        >
          Duplicate
        </WorkflowButton>
      )}
      {showConvertFromQuote && (
        <WorkflowButton
          data-testid="action-convert-from-quote"
          onClick={onConvertFromQuote}
        >
          Convert from quote
        </WorkflowButton>
      )}
      {showConvertFromProject && (
        <WorkflowButton
          data-testid="action-convert-from-project"
          onClick={onConvertFromProject}
        >
          Convert from project
        </WorkflowButton>
      )}
      {showDownloadPdf && (
        <WorkflowButton
          data-testid="action-download-pdf"
          onClick={onDownloadPdf}
          pending={pending.pdf ?? false}
        >
          Download PDF
        </WorkflowButton>
      )}
    </div>
  );
}

function WorkflowButton({
  children,
  onClick,
  pending,
  variant = 'default',
  ...rest
}: {
  children: ReactNode;
  onClick: () => void;
  pending?: boolean;
  variant?: 'default' | 'primary' | 'danger';
  'data-testid'?: string;
}) {
  const base = 'rounded-md px-3 py-1 text-sm font-medium disabled:opacity-50';
  const classes =
    variant === 'primary'
      ? 'bg-brand text-brand-fg hover:opacity-90'
      : variant === 'danger'
        ? 'border border-danger/40 bg-bg text-danger hover:bg-danger/5'
        : 'border border-border bg-bg text-fg hover:bg-bg-muted';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={`${base} ${classes}`}
      data-testid={rest['data-testid']}
    >
      {pending ? 'Working…' : children}
    </button>
  );
}

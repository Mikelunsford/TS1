/**
 * Shared workflow action button. Identical visual treatment to the one
 * embedded in InvoiceWorkflowButtons; extracted so the procurement +
 * expense workflow components don't each rebuild their own.
 */
import type { ReactNode } from 'react';

export type WorkflowButtonVariant = 'default' | 'primary' | 'danger';

export function WorkflowButton({
  children,
  onClick,
  pending,
  variant = 'default',
  ...rest
}: {
  children: ReactNode;
  onClick: () => void;
  pending?: boolean;
  variant?: WorkflowButtonVariant;
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

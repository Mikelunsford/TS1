import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

/**
 * Shared error fallback for list / detail pages. Renders inside the route
 * content area so the outer AppShell stays intact. The page-level
 * <ErrorBoundary> handles render-phase crashes; this component handles
 * known data-fetch failures (React Query `error`).
 */
export function ErrorState({
  title = 'Something went wrong',
  error,
  action,
  className,
}: {
  title?: string;
  error?: unknown;
  action?: ReactNode;
  className?: string;
}) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred.';

  return (
    <div
      role="alert"
      className={cn(
        'rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-fg',
        className,
      )}
    >
      <p className="font-medium text-danger">{title}</p>
      <p className="mt-1 text-fg-muted">{message}</p>
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

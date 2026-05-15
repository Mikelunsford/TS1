import type { ReactNode } from 'react';

/**
 * Three-line empty state used by every list page. The constitution requires
 * every page to have explicit empty / loading / error states — this is the
 * shared empty surface.
 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center rounded-md border border-dashed border-border px-6 py-12 text-center"
    >
      <p className="text-base font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-md text-sm text-fg-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

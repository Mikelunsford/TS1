import type { ReactNode } from 'react';

import { cn } from '@/lib/format';

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-bg-muted text-fg ring-1 ring-border',
  success: 'bg-success/10 text-success ring-1 ring-success/30',
  warning: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  danger: 'bg-danger/10 text-danger ring-1 ring-danger/30',
  info: 'bg-info/10 text-info ring-1 ring-info/30',
};

/**
 * Tiny rounded label used for tags and inline metadata. Inherits font from
 * its container; size is fixed (`text-xs`). Pass `tone` to colorize.
 */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium',
        toneClasses[tone],
      )}
    >
      {children}
    </span>
  );
}

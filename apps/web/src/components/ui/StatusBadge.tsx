/**
 * StatusBadge — shared primitive for all entity status pills.
 *
 * Closes the UI-audit "affordance lies" finding: every status pill in the
 * app rendered as a dead `<span>` with no hover/focus/aria-label, even when
 * the surrounding row was clickable. This primitive standardises:
 *
 *   - tone vocabulary (success / warning / danger / info / muted / accent /
 *     neutral) keyed to existing Tailwind tokens in tailwind.config.ts
 *   - rounded-md (NOT rounded-full — that's FilterChip's shape)
 *   - WCAG-compliant aria-label
 *   - keyboard affordance: when onClick or asLink is passed, renders an
 *     interactive element with focus-visible ring + cursor-pointer
 *
 * The 15 entity *StatusBadge wrappers (InvoiceStatusBadge, PaymentStatusBadge,
 * QuoteStatusBadge, etc.) compose this primitive — each one maps its typed
 * enum → { tone, label } and forwards. Wrappers keep their existing public
 * API so callers stay untouched.
 *
 * Note: a separate ClientStatusBadge (sibling file) covers customer
 * client_status — its API is `{ status: string }` (open enum) and is
 * imported by name from a few customer-only call sites; that's why it
 * lives separately.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { cn } from '@/lib/cn';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted' | 'accent';
export type Size = 'sm' | 'md';

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-bg-muted text-fg ring-1 ring-border',
  info: 'bg-info/10 text-info ring-1 ring-info/30',
  success: 'bg-success/10 text-success ring-1 ring-success/30',
  warning: 'bg-warning/10 text-warning ring-1 ring-warning/30',
  danger: 'bg-danger/10 text-danger ring-1 ring-danger/30',
  muted: 'bg-bg-muted text-fg-muted ring-1 ring-border',
  accent: 'bg-accent/15 text-accent ring-1 ring-accent/30',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-2 py-0.5 text-xs',
  md: 'px-2.5 py-1 text-xs',
};

const BASE = 'inline-flex items-center rounded-md font-medium';

const INTERACTIVE =
  'cursor-pointer hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

const STATIC = 'cursor-default';

export interface StatusBadgeProps {
  tone: Tone;
  /** Human label rendered inside the pill. NOT the raw enum value. */
  label: string;
  /** sm (default): px-2 py-0.5 text-xs. md: px-2.5 py-1 text-xs (≥32px hit target). */
  size?: Size | undefined;
  /** Title tooltip — set when a denser explanation helps. */
  title?: string | undefined;
  /** Overrides label for screen readers. Defaults to the visible label. */
  ariaLabel?: string | undefined;
  /** data-testid override. */
  testId?: string | undefined;
  /** When set, renders a <button> with hover + focus affordances. */
  onClick?: (() => void) | undefined;
  /** When set, renders a <Link to=...>. Mutually exclusive with onClick. */
  asLink?: { to: string } | undefined;
  className?: string | undefined;
}

/**
 * Render a status pill. Default is non-interactive `<span>`. Pass `onClick`
 * for a `<button>` affordance, or `asLink` for a `<Link>` from react-router.
 */
export function StatusBadge({
  tone,
  label,
  size = 'sm',
  title,
  ariaLabel,
  testId,
  onClick,
  asLink,
  className,
}: StatusBadgeProps): ReactNode {
  const sharedClass = cn(BASE, SIZE_CLASSES[size], TONE_CLASSES[tone], className);
  const accessibleLabel = ariaLabel ?? label;

  if (asLink) {
    return (
      <Link
        to={asLink.to}
        className={cn(sharedClass, INTERACTIVE)}
        title={title}
        aria-label={accessibleLabel}
        data-testid={testId}
      >
        {label}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(sharedClass, INTERACTIVE)}
        title={title}
        aria-label={accessibleLabel}
        data-testid={testId}
      >
        {label}
      </button>
    );
  }

  return (
    <span
      className={cn(sharedClass, STATIC)}
      title={title}
      aria-label={accessibleLabel}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

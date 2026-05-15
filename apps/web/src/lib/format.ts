/**
 * Tiny formatting + class-name helpers. Browser `Intl` only — no date-fns at
 * the UI layer per the Wave 2 dispatch override. (`date-fns` is still keep-
 * listed for server / money-adjacent work; this file is the SPA's display
 * surface.)
 *
 * See TS1/03-workspace/00-SHARED-CONTEXT.md §"Forbidden Patterns" — no
 * hand-rolled date math. We delegate everything to `Intl.RelativeTimeFormat`
 * and `Intl.DateTimeFormat`.
 */

/**
 * Concatenate Tailwind class strings, dropping falsy values. We intentionally
 * do NOT pull in `clsx` or `classnames` for this — the function is six lines
 * and avoids a banned-dep argument in code review.
 */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * Format an ISO timestamp as a localized absolute date (e.g. "May 15, 2026").
 * Returns the empty string for nullish input so callers can pipe through.
 */
export function formatDate(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

/**
 * Format an ISO timestamp as "x time ago" / "in x time" relative to now.
 * Uses `Intl.RelativeTimeFormat` so we never compute date math ourselves.
 */
export function formatRelativeTime(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(diffMs);
  const sec = 1000;
  const min = 60 * sec;
  const hr = 60 * min;
  const day = 24 * hr;
  const wk = 7 * day;
  const mo = 30 * day;
  const yr = 365 * day;
  if (abs < min) return rtf.format(Math.round(diffMs / sec), 'second');
  if (abs < hr) return rtf.format(Math.round(diffMs / min), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hr), 'hour');
  if (abs < wk) return rtf.format(Math.round(diffMs / day), 'day');
  if (abs < mo) return rtf.format(Math.round(diffMs / wk), 'week');
  if (abs < yr) return rtf.format(Math.round(diffMs / mo), 'month');
  return rtf.format(Math.round(diffMs / yr), 'year');
}

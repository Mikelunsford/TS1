/**
 * Date formatting. The ESLint config bans `date-fns`, `dayjs`, `moment` and
 * forces native `Intl` APIs. Used by CRM list views and the audit-log surface.
 */

interface FormatDateOptions {
  locale?: string;
  /** Format style: 'short' = 5/15/26, 'medium' = May 15, 2026, 'long' = May 15, 2026 (default medium) */
  style?: 'short' | 'medium' | 'long';
}

/**
 * Render an ISO-8601 timestamp or `YYYY-MM-DD` date string. Returns `—` when
 * input is null/undefined/empty — every list page renders this for nullable
 * date columns.
 */
export function formatDate(
  input: string | Date | null | undefined,
  opts: FormatDateOptions = {},
): string {
  if (input === null || input === undefined || input === '') return '—';
  const { locale = 'en-US', style = 'medium' } = opts;
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return '—';

  const fmt = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: style === 'short' ? 'numeric' : style === 'long' ? 'long' : 'short',
    day: 'numeric',
  });
  return fmt.format(date);
}

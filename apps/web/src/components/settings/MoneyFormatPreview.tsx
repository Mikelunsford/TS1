/**
 * MoneyFormatPreview — renders a $1,234.56 sample given currency code.
 */

interface Props {
  currencyCode?: string | null;
}

export function MoneyFormatPreview({ currencyCode }: Props) {
  const code = currencyCode || 'USD';
  let formatted = `$1,234.56 ${code}`;
  try {
    formatted = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
    }).format(1234.56);
  } catch {
    /* invalid currency code — keep fallback */
  }
  return (
    <div className="rounded-md border border-border bg-bg-muted px-3 py-2 text-xs text-fg-muted">
      <span className="font-semibold text-fg">{formatted}</span> sample using{' '}
      <span className="font-mono">{code}</span>
    </div>
  );
}

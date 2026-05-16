import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Shared report table. Column-defs-driven so each report page just supplies
 * column metadata + the row array. Renders an optional footer row for totals.
 *
 * Right-aligned numeric columns use `align: 'right'`. Money formatting is the
 * caller's responsibility — pass a pre-formatted ReactNode in the column
 * accessor or use <MoneyDisplay> inside it.
 */
export interface ReportColumn<TRow> {
  key: string;
  header: string;
  /** Cell renderer for the row. */
  render: (row: TRow) => ReactNode;
  align?: 'left' | 'right';
  className?: string;
}

export interface ReportTableProps<TRow> {
  columns: Array<ReportColumn<TRow>>;
  rows: TRow[];
  rowKey: (row: TRow, index: number) => string;
  /** Optional totals row rendered in a `<tfoot>`. */
  footer?: Array<ReactNode>;
  emptyText?: string;
  caption?: string;
  /** data-testid prefix for each row (default 'report-row'). */
  testIdPrefix?: string;
}

export function ReportTable<TRow>({
  columns,
  rows,
  rowKey,
  footer,
  emptyText = 'No rows to display.',
  caption,
  testIdPrefix = 'report-row',
}: ReportTableProps<TRow>) {
  if (rows.length === 0) {
    return (
      <p
        role="status"
        className="rounded-md border border-dashed border-border bg-bg-muted/40 px-4 py-6 text-center text-sm text-fg-muted"
      >
        {emptyText}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="min-w-full divide-y divide-border text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-bg-muted text-left text-xs uppercase tracking-wide text-fg-subtle">
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                className={cn(
                  'px-3 py-2 font-medium',
                  c.align === 'right' && 'text-right',
                  c.className,
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row, i) => (
            <tr
              key={rowKey(row, i)}
              className="hover:bg-bg-muted"
              data-testid={`${testIdPrefix}-${i}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={cn(
                    'px-3 py-2 text-fg',
                    c.align === 'right' && 'text-right font-mono',
                    c.className,
                  )}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && footer.length > 0 && (
          <tfoot className="bg-bg-muted text-sm font-medium text-fg">
            <tr data-testid={`${testIdPrefix}-total`}>
              {footer.map((cell, i) => (
                <td
                  key={i}
                  className={cn(
                    'px-3 py-2',
                    columns[i]?.align === 'right' && 'text-right font-mono',
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

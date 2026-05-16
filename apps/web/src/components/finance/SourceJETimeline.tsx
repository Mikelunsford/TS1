/**
 * SourceJETimeline — reusable widget. Given a `(source_type, source_id)`
 * pair, fetches the auto-generated JEs for that source via
 * `GET /journal-entries?source_type=X&source_id=Y` and renders them as a
 * compact timeline. Used on invoice / payment / expense / vendor-bill
 * detail pages (Wave 8b auto-JE hooks).
 *
 * Cap-gated on `finance.journal_entries.read` — the BE will 403 us
 * anyway, but we hide the section for non-accounting users.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { JEStatusBadge } from '@/components/finance/JEStatusBadge';
import { ErrorState } from '@/components/ui/ErrorState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatDate } from '@/lib/format';
import { useCapabilities } from '@/lib/hooks/useCapabilities';
import { journalEntryKeys } from '@/lib/queryKeys/journalEntries';
import { listJournalEntries } from '@/lib/services/journalEntriesService';
import type { JournalEntrySourceType } from '@/lib/types';

export interface SourceJETimelineProps {
  sourceType: JournalEntrySourceType;
  sourceId: string;
  /** Override heading. Default "Journal entries". */
  title?: string;
}

export function SourceJETimeline({
  sourceType,
  sourceId,
  title = 'Journal entries',
}: SourceJETimelineProps) {
  const { can } = useCapabilities();
  const allowed = can('finance.journal_entries.read');

  const query = useQuery({
    queryKey: journalEntryKeys.bySource(sourceType, sourceId),
    queryFn: () => listJournalEntries({ source_type: sourceType, source_id: sourceId }),
    enabled: allowed && sourceId.length > 0,
    staleTime: 15_000,
  });

  if (!allowed) return null;

  const items = query.data?.items ?? [];

  return (
    <section
      aria-labelledby="je-timeline-heading"
      className="space-y-3 rounded-md border border-border bg-bg p-4"
      data-testid="source-je-timeline"
    >
      <header className="flex items-center justify-between">
        <h2 id="je-timeline-heading" className="text-lg font-semibold">
          {title}
        </h2>
        <span className="text-xs uppercase tracking-wide text-fg-subtle">
          Source: {sourceType}
        </span>
      </header>

      {query.isLoading && <Skeleton className="h-12 w-full" />}
      {query.error && <ErrorState title="Could not load journal entries" error={query.error} />}
      {!query.isLoading && items.length === 0 && (
        <p className="text-sm text-fg-muted" data-testid="source-je-empty">
          No journal entries yet for this {sourceType.replace('_', ' ')}.
        </p>
      )}
      {items.length > 0 && (
        <ul className="divide-y divide-border" data-testid="source-je-list">
          {items.map((je) => (
            <li
              key={je.id}
              className="flex flex-wrap items-center justify-between gap-3 py-2"
              data-testid={`source-je-item-${je.id}`}
            >
              <div className="flex items-center gap-3">
                <Link
                  to={`/finance/journal-entries/${je.id}`}
                  className="font-mono text-sm text-brand hover:underline focus:outline-none focus:ring-2 focus:ring-brand"
                >
                  {je.entry_number}
                </Link>
                <JEStatusBadge status={je.status} />
                <span className="text-xs text-fg-muted">{formatDate(je.entry_date)}</span>
              </div>
              <div className="flex items-center gap-3 text-xs">
                {je.description && (
                  <span className="max-w-md truncate text-fg-muted">{je.description}</span>
                )}
                <span className="font-mono text-fg-muted">{je.currency_code}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

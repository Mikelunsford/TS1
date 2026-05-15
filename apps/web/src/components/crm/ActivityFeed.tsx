import { useQuery } from '@tanstack/react-query';
import { Calendar, Mail, MessageSquare, Phone, StickyNote, type LucideIcon } from 'lucide-react';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/lib/format';
import type { ActivityKind } from '@/lib/types';
import { activityKeys } from '@/lib/queryKeys/crm';
import { listActivities, type ActivityListFilters } from '@/lib/services/activitiesService';

/**
 * The CRM activities API today only filters by the four CRM core entity
 * types — quote/project/invoice live outside this surface. Match that.
 */
type CrmActivityEntityType = NonNullable<ActivityListFilters['entity_type']>;

/**
 * Polymorphic activity timeline used by:
 *   - `/crm/activities` (no filter — feed for the active org)
 *   - the Activities tab on CustomerDetailPage (filtered to one entity)
 *
 * Body is rendered as plain text. Markdown support is deferred — adding a
 * markdown dep is not justified for v1 and would need an R-02 escalation.
 */
const kindIcon: Record<ActivityKind, LucideIcon> = {
  call: Phone,
  meeting: Calendar,
  email: Mail,
  note: StickyNote,
  task: MessageSquare,
};

const kindLabel: Record<ActivityKind, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  note: 'Note',
  task: 'Task',
};

export function ActivityFeed({
  entity_type,
  entity_id,
}: {
  entity_type?: CrmActivityEntityType;
  entity_id?: string;
} = {}) {
  const params: ActivityListFilters = {};
  if (entity_type) params.entity_type = entity_type;
  if (entity_id) params.entity_id = entity_id;
  const query = useQuery({
    queryKey:
      entity_type && entity_id
        ? activityKeys.byEntity(entity_type, entity_id)
        : activityKeys.list({ ...params }),
    queryFn: () => listActivities(params),
    staleTime: 30_000,
  });

  if (query.isLoading) return <TableSkeleton rows={4} cols={1} />;
  if (query.error) return <ErrorState title="Could not load activities" error={query.error} />;

  const items = query.data?.items ?? [];
  if (items.length === 0) {
    return (
      <EmptyState
        title="No activities yet"
        description={
          entity_type
            ? `Activities logged against this ${entity_type} will appear here.`
            : 'Calls, meetings, emails, and notes will show up here as the team logs them.'
        }
      />
    );
  }

  return (
    <ol className="space-y-3" aria-label="Activity feed">
      {items.map((a) => {
        const Icon = kindIcon[a.kind];
        return (
          <li key={a.id} className="rounded-md border border-border bg-bg p-3">
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-4 w-4 text-fg-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-fg-subtle">
                    {kindLabel[a.kind]}
                  </span>
                  <p className="truncate text-sm font-medium text-fg">{a.subject}</p>
                  <time
                    className="ml-auto shrink-0 text-xs text-fg-muted"
                    dateTime={a.created_at}
                    title={a.created_at}
                  >
                    {formatRelativeTime(a.created_at)}
                  </time>
                </div>
                {a.body && (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-fg-muted">{a.body}</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

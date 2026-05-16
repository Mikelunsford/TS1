/**
 * AuditTimeline (Phase 17 — Wave 10 Session 2 / Agent B2).
 *
 * Per-entity audit timeline. Reads audit_log via the supabase client (with
 * RLS — only org_owner / org_admin / accounting see rows per post-0068
 * `audit_select_staff` policy). Displays reverse-chronological actions with
 * actor + diff.
 *
 * Wiring scope for this PR: demo wiring on InvoiceDetailPage. Session 4
 * portals will wire it on every entity detail page.
 *
 * TODO Session 4: wire into every entity detail page (quotes, projects,
 * customers, vendors, POs, etc).
 */

import { useQuery } from '@tanstack/react-query';

import { searchKeys } from '@/lib/queryKeys/search';
import { AuditRowSchema, type AuditRow } from '@/lib/services/searchService';
import { supabase } from '@/lib/supabase';

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface AuditTimelineProps {
  entityType: string;
  entityId: string;
  /** Cap render to N rows. Default 50. */
  limit?: number;
}

async function fetchAuditTimeline(
  entityType: string,
  entityId: string,
  limit: number,
): Promise<AuditRow[]> {
  const { data, error } = await supabase
    .from('audit_log')
    .select(
      'id, org_id, entity_type, entity_id, from_state, to_state, triggered_by, triggered_at, action, diff_json, notes',
    )
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('triggered_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => AuditRowSchema.parse(row));
}

export function AuditTimeline({ entityType, entityId, limit = 50 }: AuditTimelineProps) {
  const query = useQuery({
    queryKey: searchKeys.auditTimeline(entityType, entityId),
    queryFn: () => fetchAuditTimeline(entityType, entityId, limit),
    staleTime: 30_000,
  });

  if (query.isLoading) {
    return <div className="text-sm text-fg-muted">Loading history…</div>;
  }
  if (query.isError) {
    return (
      <div className="text-sm text-fg-muted">
        Unable to load history.
      </div>
    );
  }
  const rows = query.data ?? [];
  if (rows.length === 0) {
    return <div className="text-sm text-fg-muted">No history yet.</div>;
  }

  return (
    <ol className="space-y-2">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-border p-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="font-medium">
              {row.action ?? 'change'}
              {row.from_state && row.to_state && (
                <span className="ml-2 text-fg-muted">
                  {row.from_state} → {row.to_state}
                </span>
              )}
            </span>
            <span
              className="text-xs text-fg-muted"
              title={row.triggered_at}
            >
              {relativeTime(row.triggered_at)}
            </span>
          </div>
          {row.notes && (
            <div className="mt-1 text-xs text-fg-muted">{row.notes}</div>
          )}
          {row.diff_json !== null && row.diff_json !== undefined && (
            <details className="mt-1">
              <summary className="cursor-pointer text-xs text-fg-muted">
                Diff
              </summary>
              <pre className="mt-1 overflow-x-auto rounded bg-bg-subtle p-1 text-xs">
                {JSON.stringify(row.diff_json, null, 2)}
              </pre>
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

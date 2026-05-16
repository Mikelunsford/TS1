/**
 * Audit log writer (Phase 17 — Wave 10 Session 2 / Agent B2).
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Allowed Patterns" and
 * TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §4.4, every state-changing
 * Edge Function handler writes one row to `audit_log` with the before/after
 * diff of the changed entity.
 *
 * Phase 17: this used to be a no-op stub; it now performs a real INSERT
 * against `public.audit_log`. Service-role bypasses the post-0068 RLS that
 * denies INSERT/UPDATE/DELETE to authenticated.
 *
 * State-change triggers on the DB side (invoices, opportunities, leads,
 * vendor-bills via 0041 / 0047 / 0058 etc.) ALREADY write their own audit_log
 * rows on `status` transitions. Handlers should call `writeAudit()` for the
 * NON-state-change cases: create, edit of important fields, soft-delete,
 * domain actions that don't move a state machine (e.g. /send activity rows).
 *
 * Writes are best-effort: an audit-log INSERT failure must NEVER fail the
 * caller's primary action. We log + swallow.
 */

import { admin } from './handler-helpers.ts';
import { error as logError } from './logger.ts';

export interface AuditEntry {
  /** uuid of the user who performed the action; null only for system-emitted rows. */
  actor_user_id: string | null;
  /** org scope. Required (the post-0068 indexes are all org-leading). */
  org_id: string;
  /** Logical entity type. Must be in the audit_log_entity_type_check_v2 set (post-0068). */
  entity_type: string;
  /** Primary key uuid of the affected row. */
  entity_id: string;
  /**
   * Verb for the action, e.g. 'create' | 'update' | 'archive' | 'restore' |
   * 'send' | 'state_change' | 'soft_delete'. Free-form for now.
   */
  action: string;
  /** Optional from-state (used by state machines; null for create/update). */
  from_state?: string | null;
  /** Optional to-state. */
  to_state?: string | null;
  /** Pre-state snapshot of the row (or relevant subset). Used to compute diff. */
  before?: Record<string, unknown> | null;
  /** Post-state snapshot of the row (or relevant subset). */
  after?: Record<string, unknown> | null;
  /** Free-form note (e.g. cancellation reason, /send recipient list). */
  notes?: string | null;
  /** Extra structured metadata (request_id, route, idempotency_key, etc.). */
  metadata?: Record<string, unknown> | null;
}

/**
 * Compute a shallow object diff. Returns {before, after, changed} where
 * `changed` is the list of keys that differ. If both before and after are
 * undefined, returns null (the caller is supplying only after-state).
 */
export function computeDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!before && !after) return null;
  if (!before) return { after };
  if (!after) return { before };
  const changed: Record<string, { before: unknown; after: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const a = (before as Record<string, unknown>)[k];
    const b = (after as Record<string, unknown>)[k];
    // Cheap deep-equal via JSON stringify (audit-log diffs are bounded by
    // entity row size — typically < 4 kB).
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      changed[k] = { before: a, after: b };
    }
  }
  return { changed };
}

/**
 * Write one row to `audit_log`. Best-effort: errors are logged but never
 * thrown to the caller. The handler's primary action stays the source of truth.
 */
export async function writeAudit(entry: AuditEntry): Promise<void> {
  try {
    const diff = computeDiff(entry.before, entry.after);
    const row = {
      org_id: entry.org_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      from_state: entry.from_state ?? null,
      to_state: entry.to_state ?? null,
      triggered_by: entry.actor_user_id,
      triggered_at: new Date().toISOString(),
      action: entry.action,
      diff_json: diff,
      notes: entry.notes ?? null,
    };
    const { error } = await admin().from('audit_log').insert(row);
    if (error) {
      logError('audit_log insert failed', {
        detail: error.message,
        org_id: entry.org_id,
        entity_type: entry.entity_type,
        entity_id: entry.entity_id,
        action: entry.action,
      });
    }
  } catch (e) {
    logError('audit_log insert threw', {
      err: e instanceof Error ? e.message : String(e),
      org_id: entry.org_id,
      entity_type: entry.entity_type,
      entity_id: entry.entity_id,
      action: entry.action,
    });
  }
}

export {};

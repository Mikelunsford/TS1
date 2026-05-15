/**
 * Audit log writer.
 *
 * Per TS1/03-workspace/00-SHARED-CONTEXT.md "Allowed Patterns" and
 * TS1/07-architecture/00-SYSTEM-ARCHITECTURE.md §4.4, every state-changing
 * Edge Function handler writes one row to `audit_log` with the before/after
 * diff of the changed entity.
 *
 * Wave 0: no-op stub. The table exists in migrations from Wave 1+; this
 * helper exists so handler code can call it without conditional branches.
 *
 * TODO Wave 1: implement against the `audit_log` table (renamed from
 * `workflow_transitions` per architecture §4.4).
 */

import type { SupabaseClient } from './supabase-admin.ts';

export interface AuditEntry {
  actor_user_id: string | null;
  org_id: string;
  entity_type: string; // e.g. 'invoice', 'quote'
  entity_id: string;
  action: string; // e.g. 'created', 'issued', 'voided'
  before?: unknown;
  after?: unknown;
  request_id?: string;
}

export async function writeAudit(
  _supabase: SupabaseClient,
  _entry: AuditEntry,
): Promise<void> {
  // TODO Wave 1: INSERT INTO public.audit_log (...) VALUES (...)
  // Use the service-role client; RLS on audit_log permits service inserts only.
  return;
}

export {};

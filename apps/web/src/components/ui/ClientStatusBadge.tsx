/**
 * Customer client_status pill. Renamed from StatusBadge.tsx as part of the
 * UI-audit refactor — the StatusBadge name now hosts the shared primitive
 * that all 15 entity badges compose. This file keeps the customer-only
 * open-enum semantics (unknown values fall back to a neutral pill).
 *
 * Known client_status values. Backend's canonical Customer schema types
 * `client_status` as a plain string (open enum), so this list lives here next
 * to the rendering logic that depends on it.
 */
import { Badge } from './Badge';

export type ClientStatus = 'new' | 'active' | 'inactive' | 'archived';

const statusToTone: Record<ClientStatus, 'success' | 'info' | 'neutral' | 'warning'> = {
  active: 'success',
  new: 'info',
  inactive: 'neutral',
  archived: 'warning',
};

const statusToLabel: Record<ClientStatus, string> = {
  active: 'Active',
  new: 'New',
  inactive: 'Inactive',
  archived: 'Archived',
};

function isKnownStatus(s: string): s is ClientStatus {
  return s === 'new' || s === 'active' || s === 'inactive' || s === 'archived';
}

/**
 * Customer client_status pill. Color logic lives here so list & detail render
 * consistently. Renamed from `StatusBadge` (2026-05-18 UI audit).
 */
export function ClientStatusBadge({ status }: { status: string }) {
  if (isKnownStatus(status)) {
    return <Badge tone={statusToTone[status]}>{statusToLabel[status]}</Badge>;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

import { Badge } from './Badge';

/**
 * Known client_status values. Backend's canonical Customer schema types
 * `client_status` as a plain string (open enum), so this list lives here next
 * to the rendering logic that depends on it. Unknown values fall back to a
 * neutral pill.
 */
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
 * consistently.
 */
export function StatusBadge({ status }: { status: string }) {
  if (isKnownStatus(status)) {
    return <Badge tone={statusToTone[status]}>{statusToLabel[status]}</Badge>;
  }
  return <Badge tone="neutral">{status}</Badge>;
}

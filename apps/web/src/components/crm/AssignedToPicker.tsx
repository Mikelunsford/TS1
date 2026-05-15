import { cn } from '@/lib/format';

/**
 * Owner picker. v1 surface is a plain native <select> populated by a
 * pre-fetched list of org members; the data fetch is the caller's
 * responsibility because the org_members service does not yet exist on this
 * branch (Backend will land `useOrgMembers` as part of Wave 2 Step 3.2).
 *
 * Empty options list renders a disabled "No members" placeholder so the
 * control degrades gracefully when the parent hasn't wired the data yet.
 */
export interface OrgMemberOption {
  user_id: string;
  display_name: string;
}

export function AssignedToPicker({
  value,
  onChange,
  options,
  includeUnassigned = true,
  id,
  className,
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  options: OrgMemberOption[];
  includeUnassigned?: boolean;
  id?: string;
  className?: string;
}) {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className={cn(
        'rounded-md border border-border bg-bg px-2 py-1 text-sm text-fg focus:outline-none focus:ring-2 focus:ring-brand',
        className,
      )}
      aria-label="Assigned to"
    >
      {includeUnassigned && <option value="">Unassigned</option>}
      {options.length === 0 && !includeUnassigned && (
        <option value="" disabled>
          No members
        </option>
      )}
      {options.map((m) => (
        <option key={m.user_id} value={m.user_id}>
          {m.display_name}
        </option>
      ))}
    </select>
  );
}

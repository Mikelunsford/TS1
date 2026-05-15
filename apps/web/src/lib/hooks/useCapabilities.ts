/**
 * Hook returning a memoized `can(cap)` predicate for the active role.
 * Backed by `useMe()` — falls back to a deny-all when the role is unknown.
 *
 * See `lib/capabilities.ts` and `_shared/capabilities.ts`.
 */
import { useMemo } from 'react';

import { can } from '../capabilities';
import { useMe } from './useMe';

export interface CapabilitiesApi {
  /** Currently active role, or null while loading / signed out. */
  role: ReturnType<typeof useMe>['data'] extends infer T
    ? T extends { active_role: infer R }
      ? R
      : null
    : null;
  can: (cap: string) => boolean;
}

export function useCapabilities() {
  const me = useMe();
  const role = me.data?.active_role ?? null;

  return useMemo(
    () => ({
      role,
      can: (cap: string) => can(role, cap),
    }),
    [role],
  );
}

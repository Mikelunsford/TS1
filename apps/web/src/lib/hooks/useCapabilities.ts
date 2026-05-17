/**
 * Hook returning a memoized `can(cap)` predicate for the active role.
 * Backed by `useMe()` — falls back to a deny-all when the role is unknown.
 *
 * Wave 10 fix: useMe is now gated on `state.status === 'authenticated'`
 * so the /auth-api/me request is never fired before the Supabase session
 * has hydrated from localStorage. Without this, the first render fires
 * a request that the apiClient builds with no Authorization header (the
 * session promise hasn't resolved yet), the Supabase gateway 401s
 * (`UNAUTHORIZED_NO_AUTH_HEADER`), and a transient error shows in the
 * console even though React Query then retries successfully.
 *
 * See `lib/capabilities.ts` and `_shared/capabilities.ts`.
 */
import { useMemo } from 'react';

import { useAuth } from '../../auth/AuthContext';
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
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
  const role = me.data?.active_role ?? null;

  return useMemo(
    () => ({
      role,
      can: (cap: string) => can(role, cap),
    }),
    [role],
  );
}

/**
 * useIsPlatformAdmin — Phase 23 (Wave 10 Session 4).
 *
 * Checks whether the current user has an active row in `platform_admins`
 * by calling GET /admin-console-api/admin/me. Returns false on any 4xx
 * (handler returns 403 for non-admins).
 *
 * Caches for 5 minutes; admin status changes are rare and the server is the
 * authority on every actual admin action.
 */
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '../apiClient';
import { getAdminMe } from '../services/adminConsoleService';

export function useIsPlatformAdmin(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: async () => {
      try {
        const me = await getAdminMe();
        return { isPlatformAdmin: true as const, me };
      } catch (e) {
        if (e instanceof ApiError && (e.code === 'FORBIDDEN' || e.code === 'UNAUTHORIZED')) {
          return { isPlatformAdmin: false as const, me: null };
        }
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
    enabled: opts.enabled ?? true,
  });
}

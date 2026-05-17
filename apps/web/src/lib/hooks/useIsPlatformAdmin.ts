/**
 * useIsPlatformAdmin — Phase 23 (Wave 10 Session 4), refined in R-W11-MFA-TEST-01.
 *
 * Reads `is_platform_admin` from the 200 response of GET /admin/me. Pre-W11
 * the endpoint threw 403 for non-admins; the browser-native "Failed to
 * load resource: 403" console line was unsuppressible from JS and appeared
 * on every staff page-load for non-admin users. The handler now returns
 * 200 with `is_platform_admin: false` instead — the hook just reads the
 * field directly.
 *
 * Caches for 5 minutes; admin grants/revocations are rare and the server
 * is the authority on every actual admin action.
 */
import { useQuery } from '@tanstack/react-query';

import { getAdminMe, type AdminMe } from '../services/adminConsoleService';

export function useIsPlatformAdmin(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['admin', 'me'],
    queryFn: async (): Promise<{ isPlatformAdmin: boolean; me: AdminMe }> => {
      const me = await getAdminMe();
      return { isPlatformAdmin: me.is_platform_admin, me };
    },
    staleTime: 5 * 60_000,
    retry: false,
    enabled: opts.enabled ?? true,
  });
}

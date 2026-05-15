import { useQuery } from '@tanstack/react-query';

import { authKeys } from '../queryKeys/auth';
import { getMe } from '../services/authService';

/**
 * React Query hook for the caller's `/auth-api/me` payload. Used by the
 * AuthContext, the workspace switcher, and the topbar.
 */
export function useMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: authKeys.me(),
    queryFn: getMe,
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

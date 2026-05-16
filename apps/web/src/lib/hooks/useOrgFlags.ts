/**
 * useOrgFlags — TanStack Query hook for `settings-api/me/flags`.
 *
 * Phase 15. Drives <RequireFlag> route gating + any feature-conditional UI
 * pieces. staleTime 5 minutes; refetch on window focus disabled to avoid
 * jitter when admins flip a flag.
 */
import { useQuery } from '@tanstack/react-query';

import { getFlags, type FlagMap } from '../services/settingsService';
import { settingsKeys } from '../queryKeys/settings';

const FIVE_MIN = 5 * 60 * 1000;

export function useOrgFlags() {
  return useQuery<FlagMap>({
    queryKey: settingsKeys.flags(),
    queryFn: getFlags,
    staleTime: FIVE_MIN,
    refetchOnWindowFocus: false,
  });
}

/**
 * Sync helper for callers that just want a boolean (returns false while loading).
 */
export function useIsFlagOn(flagKey: string): { isOn: boolean; isLoading: boolean } {
  const { data, isLoading } = useOrgFlags();
  return { isOn: !!data?.[flagKey], isLoading };
}

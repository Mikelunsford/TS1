import { useQuery } from '@tanstack/react-query';

import { tenantsKeys } from '../queryKeys/tenants';
import { getBranding } from '../services/tenantsService';

/**
 * React Query hook for the caller's active-org branding row. The
 * `BrandingProvider` consumes this and writes CSS variables; the topbar
 * consumes `data.app_name_override` for the title.
 */
export function useBranding(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tenantsKeys.branding(),
    queryFn: getBranding,
    staleTime: 5 * 60_000, // 5 minutes — branding rarely changes
    enabled: opts.enabled ?? true,
  });
}

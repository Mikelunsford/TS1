/**
 * RequireFlag — react-router v6 outlet guard that hides a route subtree
 * when the given org_feature_flags entry is disabled.
 *
 * Usage in routes.tsx:
 *   <Route element={<RequireFlag flag="inventory.enabled" />}>
 *     <Route path="/warehouses" element={<...>} />
 *     ...
 *   </Route>
 *
 * On flag-off, redirects to `/feature-unavailable?flag=<key>`. While flags
 * load, renders nothing (the Suspense fallback in routes.tsx handles the
 * blank visual).
 */
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useOrgFlags } from '@/lib/hooks/useOrgFlags';

interface Props {
  flag: string;
}

export function RequireFlag({ flag }: Props) {
  const { data: flags, isLoading } = useOrgFlags();
  const location = useLocation();

  if (isLoading) return null;

  if (flags && flags[flag] === false) {
    return (
      <Navigate
        to={`/feature-unavailable?flag=${encodeURIComponent(flag)}`}
        replace
        state={{ from: location.pathname, flag }}
      />
    );
  }

  // Flag absent === undefined: fail-open here on the SPA side. The BE
  // requireFlag middleware is the source of truth and will 403 if a
  // route is truly disabled. SPA fail-open avoids a chicken-and-egg
  // race where the org_feature_flags rows haven't seeded yet.
  return <Outlet />;
}

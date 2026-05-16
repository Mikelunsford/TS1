import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
// Phase 21 portal routing (Wave 10 Session 4) — C1 owns this block.
import { PortalShell } from '@/components/portal/PortalShell';
import { useActiveRole } from '@/lib/hooks/useActiveRole';
// End Phase 21 portal routing (Wave 10 Session 4).
// Phase 22 (Wave 10 Session 4) — C2 owns this import.
import { useMe } from '@/lib/hooks/useMe';
// End Phase 22 (Wave 10 Session 4).
import { useAuth } from './AuthContext';

/**
 * Route guard. Wave 1: authenticated -> render inside AppShell;
 * unauthenticated -> redirect to /login.
 *
 * Wave 2+ will add wrong-org (no membership for current host) and
 * wrong-role (role denied for this route) states with corresponding
 * redirects. For now any authenticated caller is rendered.
 *
 * Phase 21 (Wave 10 Session 4): customer_user role gets the dedicated
 * <PortalShell> and is redirected to /portal for any non-/portal route.
 * Staff routes never render the portal shell; portal routes never render
 * the staff shell.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
  // Phase 21 portal routing (Wave 10 Session 4) — C1 owns this block.
  const role = useActiveRole();
  // End Phase 21 portal routing (Wave 10 Session 4).
  // Phase 22 (Wave 10 Session 4) — C2 owns this block.
  // vendor_user sessions are kicked to /vendor-portal so they never
  // render staff chrome. The VendorPortalRoute guard wraps those routes
  // in <VendorPortalShell> instead of <AppShell>.
  const me = useMe({ enabled: state.status === 'authenticated' });
  // End Phase 22 (Wave 10 Session 4).

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-fg-muted">
        Checking session…
      </div>
    );
  }

  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // Phase 21 portal routing (Wave 10 Session 4) — C1 owns this block.
  // Customer users only ever see /portal/*; bounce them out of any
  // staff route they hit (typed URL, stale bookmark, etc.).
  if (role === 'customer_user') {
    const isPortal = location.pathname.startsWith('/portal');
    if (!isPortal) {
      return <Navigate to="/portal" replace />;
    }
    return <PortalShell>{children}</PortalShell>;
  }
  // End Phase 21 portal routing (Wave 10 Session 4).

  // Phase 22 (Wave 10 Session 4) — C2 owns this block.
  if (
    me.data?.active_role === 'vendor_user' &&
    !location.pathname.startsWith('/vendor-portal')
  ) {
    return <Navigate to="/vendor-portal" replace />;
  }
  // End Phase 22 (Wave 10 Session 4).

  return <AppShell>{children}</AppShell>;
}

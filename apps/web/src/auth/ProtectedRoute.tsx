import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
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
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();
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

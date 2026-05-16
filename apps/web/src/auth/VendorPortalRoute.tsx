/**
 * VendorPortalRoute — auth + shell guard for vendor_user routes.
 *
 * Phase 22 (Wave 10 Session 4) — C2 owns this guard.
 *
 * Like ProtectedRoute but wraps content in VendorPortalShell (not
 * AppShell) and asserts the caller's active role is `vendor_user`.
 * Non-vendor users are redirected to `/` (staff home).
 */

import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { VendorPortalShell } from '@/components/vendor-portal/VendorPortalShell';
import { useMe } from '@/lib/hooks/useMe';
import { useAuth } from './AuthContext';

export function VendorPortalRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const me = useMe({ enabled: state.status === 'authenticated' });
  const location = useLocation();

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
  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-fg-muted">
        Loading workspace…
      </div>
    );
  }
  if (me.data?.active_role && me.data.active_role !== 'vendor_user') {
    return <Navigate to="/" replace />;
  }
  return <VendorPortalShell>{children}</VendorPortalShell>;
}

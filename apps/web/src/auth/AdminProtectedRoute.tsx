/**
 * AdminProtectedRoute — Phase 23 (Wave 10 Session 4) — C3 owns this file.
 *
 * Like ProtectedRoute but does NOT wrap in AppShell. Admin pages use their
 * own <AdminShell> (slate-themed, separate nav) to keep the platform-admin
 * surface visually + structurally distinct from the staff app.
 *
 * Server-side every admin endpoint re-checks `is_platform_admin()`, so this
 * is purely an auth guard — the AdminShell does the platform-admin check
 * itself before rendering children.
 */
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuth } from './AuthContext';

export function AdminProtectedRoute({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
        Checking session…
      </div>
    );
  }
  if (state.status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

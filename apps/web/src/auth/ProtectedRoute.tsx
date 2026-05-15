import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { AppShell } from '@/components/shell/AppShell';
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

  return <AppShell>{children}</AppShell>;
}
